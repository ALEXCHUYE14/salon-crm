-- =====================================================================
--  003_cash_movements.sql — Gastos, retiros e ingresos de efectivo en caja
--
--  · Cada movimiento pertenece a la caja abierta (no se registran en cajas cerradas).
--  · El arqueo (register_summary / close_cash_register) los incluye en el efectivo esperado.
--  · No se puede retirar más efectivo del que hay en el cajón.
--  Re-ejecutable: usa "if not exists" / "create or replace" / "drop ... if exists".
-- =====================================================================

create table if not exists public.cash_movements (
  id                uuid primary key default gen_random_uuid(),
  cash_register_id  uuid not null constraint cash_movements_register_fk references public.cash_registers (id) on delete restrict,
  movement_type     text not null check (movement_type in ('expense', 'withdrawal', 'deposit')),
  category          text not null default 'other'
                    check (category in ('supplies', 'services', 'rent', 'salary_advance', 'commission_payout',
                                        'cleaning', 'food', 'transport', 'maintenance', 'owner', 'change_fund', 'other')),
  amount            numeric(12,2) not null check (amount > 0 and amount <= 1000000),
  description       text not null check (char_length(trim(description)) between 2 and 200),
  created_by        uuid constraint cash_movements_created_by_fk references public.staff_members (id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists cash_movements_register_idx on public.cash_movements (cash_register_id, created_at desc);
create index if not exists cash_movements_created_idx  on public.cash_movements (created_at desc);

-- ---------------------------------------------------------------------
-- Resumen de caja: ahora descuenta gastos/retiros y suma ingresos
-- ---------------------------------------------------------------------
create or replace function public.register_summary(p_register_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_reg         public.cash_registers;
  v_cash_sales  numeric;
  v_expenses    numeric;
  v_withdrawals numeric;
  v_deposits    numeric;
  v_result      jsonb;
begin
  select * into v_reg from public.cash_registers where id = p_register_id;
  if not found then
    raise exception 'Caja no encontrada' using errcode = 'P0002';
  end if;

  select coalesce(sum(p.amount), 0) into v_cash_sales
    from public.transaction_payments p
    join public.transactions t on t.id = p.transaction_id
   where t.cash_register_id = v_reg.id and t.status = 'completed' and p.method = 'cash';

  select coalesce(sum(amount) filter (where movement_type = 'expense'), 0),
         coalesce(sum(amount) filter (where movement_type = 'withdrawal'), 0),
         coalesce(sum(amount) filter (where movement_type = 'deposit'), 0)
    into v_expenses, v_withdrawals, v_deposits
    from public.cash_movements
   where cash_register_id = v_reg.id;

  select jsonb_build_object(
    'register_id', v_reg.id,
    'opening_amount', v_reg.opening_amount,
    'transactions', (select count(*) from public.transactions t where t.cash_register_id = v_reg.id and t.status = 'completed'),
    'voided', (select count(*) from public.transactions t where t.cash_register_id = v_reg.id and t.status = 'voided'),
    'gross_total', coalesce((select sum(t.total) from public.transactions t where t.cash_register_id = v_reg.id and t.status = 'completed'), 0),
    'tips', coalesce((select sum(t.tip_amount) from public.transactions t where t.cash_register_id = v_reg.id and t.status = 'completed'), 0),
    'discounts', coalesce((select sum(t.discount_amount) from public.transactions t where t.cash_register_id = v_reg.id and t.status = 'completed'), 0),
    'by_method', coalesce((
      select jsonb_object_agg(m.method, m.amount)
        from (
          select p.method, sum(p.amount) as amount
            from public.transaction_payments p
            join public.transactions t on t.id = p.transaction_id
           where t.cash_register_id = v_reg.id and t.status = 'completed'
           group by p.method
        ) m
    ), '{}'::jsonb),
    'cash_sales', v_cash_sales,
    'expenses', v_expenses,
    'withdrawals', v_withdrawals,
    'deposits', v_deposits,
    'expected_cash', v_reg.opening_amount + v_cash_sales + v_deposits - v_expenses - v_withdrawals
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- Validación de movimientos
-- ---------------------------------------------------------------------
create or replace function public.cash_movements_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_status   text;
  v_expected numeric;
begin
  -- Bloquea la caja para que no se cierre mientras se registra el movimiento
  select status into v_status from public.cash_registers where id = new.cash_register_id for update;
  if not found then
    raise exception 'Caja no encontrada' using errcode = 'P0002';
  end if;
  if v_status <> 'open' then
    raise exception 'La caja ya está cerrada; abre una nueva para registrar movimientos' using errcode = 'P0001';
  end if;

  new.description := trim(new.description);
  new.amount := round(new.amount, 2);
  new.created_by := public.current_staff_id();
  new.created_at := now();

  if new.movement_type = 'deposit' then
    new.category := case when new.category in ('change_fund', 'owner', 'other') then new.category else 'other' end;
  elsif new.movement_type = 'withdrawal' then
    new.category := case when new.category in ('owner', 'other') then new.category else 'other' end;
  end if;

  if new.movement_type in ('expense', 'withdrawal') then
    v_expected := (public.register_summary(new.cash_register_id) ->> 'expected_cash')::numeric;
    if new.amount > v_expected then
      raise exception 'No hay suficiente efectivo en caja: disponible %, solicitado %', v_expected, new.amount
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_cash_movements_before_insert on public.cash_movements;
create trigger trg_cash_movements_before_insert
  before insert on public.cash_movements
  for each row execute function public.cash_movements_before_insert();

-- Solo se pueden eliminar movimientos de la caja abierta (corrección de errores)
create or replace function public.cash_movements_before_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.cash_registers where id = old.cash_register_id and status = 'open') then
    raise exception 'No se pueden eliminar movimientos de una caja cerrada' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_cash_movements_before_delete on public.cash_movements;
create trigger trg_cash_movements_before_delete
  before delete on public.cash_movements
  for each row execute function public.cash_movements_before_delete();

-- ---------------------------------------------------------------------
-- Reporte de gastos por categoría
-- ---------------------------------------------------------------------
create or replace function public.report_cash_movements(p_from date, p_to date)
returns table (movement_type text, category text, amount numeric, movements bigint)
language plpgsql stable security invoker set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz    text := public.business_tz();
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end   timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
begin
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Rango de fechas inválido (máximo 366 días)' using errcode = '22023';
  end if;
  return query
  select m.movement_type, m.category, sum(m.amount)::numeric, count(*)::bigint
    from public.cash_movements m
   where m.created_at >= v_start and m.created_at < v_end
   group by m.movement_type, m.category
   order by 3 desc;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------
alter table public.cash_movements enable row level security;

drop policy if exists cash_movements_select on public.cash_movements;
drop policy if exists cash_movements_insert on public.cash_movements;
drop policy if exists cash_movements_delete on public.cash_movements;

create policy cash_movements_select on public.cash_movements for select to authenticated
  using (public.has_role('owner', 'admin', 'receptionist'));
create policy cash_movements_insert on public.cash_movements for insert to authenticated
  with check (public.has_role('owner', 'admin', 'receptionist'));
create policy cash_movements_delete on public.cash_movements for delete to authenticated
  using (public.has_role('owner', 'admin'));

grant select, insert, delete on public.cash_movements to authenticated;

revoke execute on function public.report_cash_movements(date, date) from public, anon;
grant execute on function public.report_cash_movements(date, date) to authenticated;
revoke execute on function public.cash_movements_before_insert() from public, anon, authenticated;
revoke execute on function public.cash_movements_before_delete() from public, anon, authenticated;
