-- Hard monthly spending ceiling for paid AI / speech APIs (owner's budget: 5 € target, 10 € maximum
-- for everything). Every paid call first RESERVES its worst-case cost; the reservation succeeds only if
-- the month's settled + reserved spend stays under the cap. After the response the reservation is
-- SETTLED with the actual cost (or released when nothing was billed). A per-month advisory lock makes
-- concurrent reservations from several learners serialise, so the cap cannot be overshot by races.
-- Amounts are in EUR (converted from USD with a conservative rate and tax multiplier by the app).
create table public.budget_ledger (
  id uuid primary key default gen_random_uuid(),
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  operation text not null,
  idempotency_key text unique,
  reserved_eur numeric(12,6) not null check (reserved_eur >= 0),
  actual_eur numeric(12,6) check (actual_eur >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index budget_ledger_period on public.budget_ledger (period, status);
create index budget_ledger_user_day on public.budget_ledger (user_id, created_at);
alter table public.budget_ledger enable row level security;
-- No policies: only the service role (server) reads or writes the ledger.
revoke all on public.budget_ledger from anon, authenticated;
grant select, insert, update, delete on public.budget_ledger to service_role;

-- What counts against the cap: settled cost, or the reserved worst case while a call is in flight
-- (a reservation never settled — e.g. a crashed process — keeps counting at its worst case).
create or replace function public.budget_committed(p_period text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case status when 'settled' then actual_eur when 'reserved' then reserved_eur else 0 end), 0)
  from public.budget_ledger where period = p_period
$$;

create or replace function public.budget_reserve(
  p_period text, p_user uuid, p_provider text, p_operation text, p_amount numeric,
  p_cap numeric, p_user_day_cap numeric, p_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing public.budget_ledger;
  v_committed numeric;
  v_user_day numeric;
  v_id uuid;
begin
  if p_amount < 0 then raise exception 'negative reservation'; end if;
  perform pg_advisory_xact_lock(hashtext('greekos-budget:' || p_period));
  -- A retried request with the same key gets the same reservation, never a second one.
  if p_key is not null then
    select * into v_existing from public.budget_ledger where idempotency_key = p_key;
    if found then
      return jsonb_build_object('ok', v_existing.status <> 'released', 'id', v_existing.id, 'replayed', true, 'committed', public.budget_committed(p_period));
    end if;
  end if;
  v_committed := public.budget_committed(p_period);
  if v_committed + p_amount > p_cap then
    return jsonb_build_object('ok', false, 'reason', 'MONTH_CAP', 'committed', v_committed, 'cap', p_cap);
  end if;
  if p_user is not null and p_user_day_cap is not null then
    select coalesce(sum(case status when 'settled' then actual_eur when 'reserved' then reserved_eur else 0 end), 0) into v_user_day
    from public.budget_ledger where user_id = p_user and created_at >= date_trunc('day', now());
    if v_user_day + p_amount > p_user_day_cap then
      return jsonb_build_object('ok', false, 'reason', 'USER_DAY_CAP', 'committed', v_committed, 'user_day', v_user_day);
    end if;
  end if;
  insert into public.budget_ledger (period, user_id, provider, operation, idempotency_key, reserved_eur)
  values (p_period, p_user, p_provider, p_operation, p_key, p_amount) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'committed', v_committed + p_amount);
end $$;

-- Settle once: the first settlement wins (a duplicate settle of a retried request changes nothing).
create or replace function public.budget_settle(p_id uuid, p_actual numeric) returns void
language sql security definer set search_path = public as $$
  update public.budget_ledger
     set actual_eur = greatest(coalesce(p_actual, 0), 0),
         status = case when coalesce(p_actual, 0) > 0 then 'settled' else 'released' end,
         settled_at = now()
   where id = p_id and status = 'reserved'
$$;

revoke all on function public.budget_committed(text) from public, anon, authenticated;
revoke all on function public.budget_reserve(text, uuid, text, text, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.budget_settle(uuid, numeric) from public, anon, authenticated;
grant execute on function public.budget_committed(text) to service_role;
grant execute on function public.budget_reserve(text, uuid, text, text, numeric, numeric, numeric, text) to service_role;
grant execute on function public.budget_settle(uuid, numeric) to service_role;
