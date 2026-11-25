-- =====================================================================
--  008_deposits_no_show.sql — Adelantos de citas e inasistencias
--
--  Flujo contable (sin doble conteo):
--   · Recibir adelanto  → entra a la caja abierta (si es efectivo, suma al arqueo).
--   · Cobrar el servicio → el adelanto se aplica como pago "deposit" (no vuelve a
--                          sumar efectivo); la venta registra el ingreso completo.
--   · Devolver adelanto → sale de la caja abierta (si es efectivo, resta del arqueo).
--   · Retener adelanto  → queda en el negocio (inasistencia/cancelación tardía).
--   · Anular la venta   → el adelanto vuelve a estar disponible.
--  Re-ejecutable.
-- =====================================================================

-- El método "deposit" solo lo usa create_sale para aplicar adelantos
alter table public.transaction_payments drop constraint if exists transaction_payments_method_check;
alter table public.transaction_payments add constraint transaction_payments_method_check
  check (method in ('cash', 'card', 'transfer', 'wallet', 'deposit'));

create table if not exists public.appointment_deposits (
  id                    uuid primary key default gen_random_uuid(),
  appointment_id        uuid not null constraint appointment_deposits_appointment_fk references public.appointments (id) on delete restrict,
  client_id             uuid constraint appointment_deposits_client_fk references public.clients (id) on delete set null,
  amount                numeric(12,2) not null check (amount > 0 and amount <= 100000),
  method                text not null check (method in ('cash', 'card', 'transfer', 'wallet')),
  reference             text check (reference is null or char_length(reference) <= 80),
  status                text not null default 'held' check (status in ('held', 'applied', 'refunded', 'forfeited')),
  cash_register_id      uuid not null constraint appointment_deposits_register_fk references public.cash_registers (id) on delete restrict,
  received_by           uuid constraint appointment_deposits_received_by_fk references public.staff_members (id) on delete set null,
  received_at           timestamptz not null default now(),
  transaction_id        uuid constraint appointment_deposits_transaction_fk references public.transactions (id) on delete set null,
  resolved_register_id  uuid constraint appointment_deposits_resolved_register_fk references public.cash_registers (id) on delete restrict,
  resolved_by           uuid constraint appointment_deposits_resolved_by_fk references public.staff_members (id) on delete set null,
  resolved_at           timestamptz,
  notes                 text check (notes is null or char_length(notes) <= 200),
  constraint appointment_deposits_resolution check ((status = 'held') = (resolved_at is null)),
  constraint appointment_deposits_applied_tx check (status <> 'applied' or transaction_id is not null)
);
create index if not exists appointment_deposits_appointment_idx on public.appointment_deposits (appointment_id);
create index if not exists appointment_deposits_register_idx on public.appointment_deposits (cash_register_id);
create index if not exists appointment_deposits_resolved_register_idx on public.appointment_deposits (resolved_register_id) where resolved_register_id is not null;

-- ---------------------------------------------------------------------
-- Registrar / resolver adelantos (RPC con validaciones)
-- ---------------------------------------------------------------------
create or replace function public.record_deposit(p_appointment_id uuid, p_amount numeric, p_method text, p_reference text default null)
returns public.appointment_deposits
language plpgsql security definer set search_path = public
as $$
declare
  v_register uuid;
  v_appt     public.appointments;
  v_row      public.appointment_deposits;
begin
  if not public.has_role('owner', 'admin', 'receptionist') then
    raise exception 'No tienes permiso para registrar adelantos' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Ingresa un monto mayor a cero' using errcode = '22023';
  end if;
  if p_method not in ('cash', 'card', 'transfer', 'wallet') then
    raise exception 'Método de pago no válido' using errcode = '22023';
  end if;

  select * into v_appt from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'Cita no encontrada' using errcode = 'P0002';
  end if;
  if v_appt.status in ('completed', 'cancelled', 'no_show') then
    raise exception 'La cita ya está cerrada; no admite adelantos' using errcode = 'P0001';
  end if;

  select id into v_register from public.cash_registers where status = 'open' limit 1 for update;
  if v_register is null then
    raise exception 'Abre la caja para registrar el adelanto' using errcode = 'P0001';
  end if;

  insert into public.appointment_deposits (appointment_id, client_id, amount, method, reference, cash_register_id, received_by)
  values (p_appointment_id, v_appt.client_id, round(p_amount, 2), p_method, nullif(trim(coalesce(p_reference, '')), ''),
          v_register, public.current_staff_id())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.resolve_deposit(p_deposit_id uuid, p_action text, p_notes text default null)
returns public.appointment_deposits
language plpgsql security definer set search_path = public
as $$
declare
  v_dep      public.appointment_deposits;
  v_register uuid;
  v_expected numeric;
begin
  if not public.has_role('owner', 'admin', 'receptionist') then
    raise exception 'No tienes permiso para gestionar adelantos' using errcode = '42501';
  end if;
  if p_action not in ('refund', 'forfeit') then
    raise exception 'Acción no válida' using errcode = '22023';
  end if;

  select * into v_dep from public.appointment_deposits where id = p_deposit_id for update;
  if not found then
    raise exception 'Adelanto no encontrado' using errcode = 'P0002';
  end if;
  if v_dep.status <> 'held' then
    raise exception 'El adelanto ya fue aplicado o resuelto' using errcode = 'P0001';
  end if;

  if p_action = 'refund' then
    select id into v_register from public.cash_registers where status = 'open' limit 1 for update;
    if v_register is null then
      raise exception 'Abre la caja para devolver el adelanto' using errcode = 'P0001';
    end if;
    if v_dep.method = 'cash' then
      v_expected := (public.register_summary(v_register) ->> 'expected_cash')::numeric;
      if v_dep.amount > v_expected then
        raise exception 'No hay suficiente efectivo en caja para devolver el adelanto (disponible %)', v_expected using errcode = 'P0001';
      end if;
    end if;
  end if;

  update public.appointment_deposits
     set status = case when p_action = 'refund' then 'refunded' else 'forfeited' end,
         resolved_register_id = v_register,
         resolved_by = public.current_staff_id(),
         resolved_at = now(),
         notes = coalesce(nullif(trim(coalesce(p_notes, '')), ''), notes)
   where id = p_deposit_id
  returning * into v_dep;
  return v_dep;
end;
$$;

-- ---------------------------------------------------------------------
-- Arqueo: suma adelantos recibidos en efectivo y resta devoluciones en efectivo
-- ---------------------------------------------------------------------
create or replace function public.register_summary(p_register_id uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_reg          public.cash_registers;
  v_cash_sales   numeric;
  v_expenses     numeric;
  v_withdrawals  numeric;
  v_deposits     numeric;
  v_adv_in       numeric;
  v_adv_cash_in  numeric;
  v_adv_cash_out numeric;
  v_result       jsonb;
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

  select coalesce(sum(amount), 0), coalesce(sum(amount) filter (where method = 'cash'), 0)
    into v_adv_in, v_adv_cash_in
    from public.appointment_deposits
   where cash_register_id = v_reg.id;

  select coalesce(sum(amount), 0) into v_adv_cash_out
    from public.appointment_deposits
   where resolved_register_id = v_reg.id and status = 'refunded' and method = 'cash';

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
    'advances_received', v_adv_in,
    'advances_cash_in', v_adv_cash_in,
    'advances_cash_out', v_adv_cash_out,
    'expected_cash', v_reg.opening_amount + v_cash_sales + v_deposits - v_expenses - v_withdrawals + v_adv_cash_in - v_adv_cash_out
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- Venta: aplica adelantos ("deposit_ids") como pago
-- ---------------------------------------------------------------------
-- SECURITY DEFINER: escribe adelantos (tabla sin escritura directa). El rol se valida al inicio.
create or replace function public.create_sale(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_register    uuid;
  v_tx          uuid;
  v_ticket      bigint;
  v_item        jsonb;
  v_pay         jsonb;
  v_subtotal    numeric := 0;
  v_discount    numeric := round(coalesce((p_payload ->> 'discount_amount')::numeric, 0), 2);
  v_tip         numeric := round(coalesce((p_payload ->> 'tip_amount')::numeric, 0), 2);
  v_total       numeric;
  v_paid        numeric := 0;
  v_cash_paid   numeric := 0;
  v_cash_recv   numeric := (p_payload ->> 'cash_received')::numeric;
  v_change      numeric := 0;
  v_client      uuid := nullif(p_payload ->> 'client_id', '')::uuid;
  v_appointment uuid := nullif(p_payload ->> 'appointment_id', '')::uuid;
  v_appt_ids    uuid[] := '{}';
  v_dep_ids     uuid[] := '{}';
  v_dep_total   numeric := 0;
  v_dep_count   integer := 0;
  v_tip_staff   uuid := nullif(p_payload ->> 'tip_staff_id', '')::uuid;
  v_has_service boolean := false;
begin
  if not public.has_role('owner', 'admin', 'receptionist') then
    raise exception 'No tienes permiso para registrar cobros' using errcode = '42501';
  end if;

  select id into v_register from public.cash_registers where status = 'open' limit 1;
  if v_register is null then
    raise exception 'No hay una caja abierta. Abre la caja antes de cobrar.' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_payload -> 'items') is distinct from 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'La venta no tiene ítems' using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload -> 'appointment_ids') = 'array' then
    select coalesce(array_agg(distinct value::uuid), '{}')
      into v_appt_ids
      from jsonb_array_elements_text(p_payload -> 'appointment_ids') as value
     where nullif(value, '') is not null;
  end if;
  if v_appointment is not null and not (v_appointment = any (v_appt_ids)) then
    v_appt_ids := v_appt_ids || v_appointment;
  end if;
  if array_length(v_appt_ids, 1) > 20 then
    raise exception 'Demasiadas citas en un mismo cobro' using errcode = '22023';
  end if;
  if v_appointment is null and array_length(v_appt_ids, 1) > 0 then
    v_appointment := v_appt_ids[1];
  end if;

  -- Adelantos a aplicar: deben estar retenidos y pertenecer a las citas cobradas
  if jsonb_typeof(p_payload -> 'deposit_ids') = 'array' then
    select coalesce(array_agg(distinct value::uuid), '{}')
      into v_dep_ids
      from jsonb_array_elements_text(p_payload -> 'deposit_ids') as value
     where nullif(value, '') is not null;
  end if;
  if array_length(v_dep_ids, 1) > 0 then
    perform 1 from public.appointment_deposits where id = any (v_dep_ids) for update;
    select count(*), coalesce(sum(amount), 0) into v_dep_count, v_dep_total
      from public.appointment_deposits
     where id = any (v_dep_ids) and status = 'held' and appointment_id = any (v_appt_ids);
    if v_dep_count <> array_length(v_dep_ids, 1) then
      raise exception 'Algún adelanto ya fue usado o no corresponde a esta cita' using errcode = 'P0001';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    v_subtotal := v_subtotal + round(
      (v_item ->> 'quantity')::numeric * (v_item ->> 'unit_price')::numeric - coalesce((v_item ->> 'discount')::numeric, 0), 2);
    if v_item ->> 'item_kind' = 'service' then
      v_has_service := true;
    end if;
  end loop;

  if v_discount < 0 or v_tip < 0 then
    raise exception 'Descuento y propina no pueden ser negativos' using errcode = '22023';
  end if;
  if v_discount > v_subtotal then
    raise exception 'El descuento (%) supera el subtotal (%)', v_discount, v_subtotal using errcode = '22023';
  end if;
  v_total := v_subtotal - v_discount + v_tip;

  if v_dep_total > v_total then
    raise exception 'El adelanto (%) supera el total de la venta (%)', v_dep_total, v_total using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_payload -> 'payments') = 'array' then
    select coalesce(sum((value ->> 'amount')::numeric), 0),
           coalesce(sum((value ->> 'amount')::numeric) filter (where value ->> 'method' = 'cash'), 0)
      into v_paid, v_cash_paid
      from jsonb_array_elements(p_payload -> 'payments')
     where value ->> 'method' <> 'deposit';
  end if;

  if round(v_paid + v_dep_total, 2) <> round(v_total, 2) then
    raise exception 'Los pagos (%) no coinciden con el total (%)', round(v_paid + v_dep_total, 2), round(v_total, 2) using errcode = '22023';
  end if;

  if v_cash_recv is not null then
    if v_cash_recv < v_cash_paid then
      raise exception 'El efectivo recibido es menor al monto en efectivo' using errcode = '22023';
    end if;
    v_change := v_cash_recv - v_cash_paid;
  end if;

  insert into public.transactions (
    cash_register_id, client_id, appointment_id, created_by, tip_staff_id,
    subtotal, discount_amount, tip_amount, total, cash_received, change_given, notes
  ) values (
    v_register, v_client, v_appointment, public.current_staff_id(), case when v_tip > 0 then v_tip_staff end,
    v_subtotal, v_discount, v_tip, v_total, v_cash_recv, v_change, nullif(p_payload ->> 'notes', '')
  )
  returning id, ticket_number into v_tx, v_ticket;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    insert into public.transaction_items (
      transaction_id, item_kind, service_id, inventory_item_id, staff_id, description, quantity, unit_price, discount
    ) values (
      v_tx,
      v_item ->> 'item_kind',
      nullif(v_item ->> 'service_id', '')::uuid,
      nullif(v_item ->> 'inventory_item_id', '')::uuid,
      nullif(v_item ->> 'staff_id', '')::uuid,
      coalesce(nullif(v_item ->> 'description', ''), 'Ítem'),
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unit_price')::numeric,
      coalesce((v_item ->> 'discount')::numeric, 0)
    );
  end loop;

  for v_pay in select value from jsonb_array_elements(coalesce(p_payload -> 'payments', '[]'::jsonb))
  loop
    if coalesce((v_pay ->> 'amount')::numeric, 0) > 0 and v_pay ->> 'method' <> 'deposit' then
      insert into public.transaction_payments (transaction_id, method, amount, reference)
      values (v_tx, v_pay ->> 'method', (v_pay ->> 'amount')::numeric, nullif(v_pay ->> 'reference', ''));
    end if;
  end loop;

  if v_dep_total > 0 then
    insert into public.transaction_payments (transaction_id, method, amount, reference)
    select v_tx, 'deposit', amount, 'Adelanto ' || to_char(received_at at time zone public.business_tz(), 'DD/MM')
      from public.appointment_deposits where id = any (v_dep_ids);
    update public.appointment_deposits
       set status = 'applied', transaction_id = v_tx, resolved_at = now(), resolved_by = public.current_staff_id()
     where id = any (v_dep_ids);
  end if;

  if array_length(v_appt_ids, 1) > 0 then
    update public.appointments set status = 'completed' where id = any (v_appt_ids) and status <> 'completed';
  end if;

  if v_client is not null then
    update public.clients
       set total_spent   = total_spent + v_total,
           visits_count  = visits_count + case when v_has_service then 1 else 0 end,
           last_visit_at = case when v_has_service then now() else last_visit_at end
     where id = v_client;
  end if;

  return jsonb_build_object('id', v_tx, 'ticket_number', v_ticket, 'total', v_total, 'change', v_change, 'deposits', v_dep_total);
end;
$$;

-- ---------------------------------------------------------------------
-- Anulación: los adelantos aplicados vuelven a quedar disponibles
-- ---------------------------------------------------------------------
-- SECURITY DEFINER: reabre adelantos aplicados. El rol se valida al inicio.
create or replace function public.void_transaction(p_transaction_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tx public.transactions;
begin
  if not public.has_role('owner', 'admin') then
    raise exception 'Solo administración puede anular ventas' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Indica el motivo de la anulación' using errcode = '22023';
  end if;

  select * into v_tx from public.transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  if v_tx.status = 'voided' then
    raise exception 'La venta ya está anulada' using errcode = 'P0001';
  end if;
  if v_tx.tip_payout_id is not null or exists (
    select 1 from public.transaction_items where transaction_id = p_transaction_id and payout_id is not null
  ) then
    raise exception 'La venta tiene comisiones ya liquidadas y no puede anularse' using errcode = 'P0001';
  end if;

  insert into public.inventory_movements (item_id, movement_type, quantity, reference, transaction_id, notes)
  select inventory_item_id, 'return', quantity, 'Anulación ticket #' || v_tx.ticket_number, v_tx.id, p_reason
    from public.transaction_items
   where transaction_id = p_transaction_id and item_kind = 'product';

  insert into public.inventory_movements (item_id, movement_type, quantity, reference, transaction_id, notes)
  select item_id, 'return', sum(quantity), 'Anulación ticket #' || v_tx.ticket_number || ' (insumos)', v_tx.id, p_reason
    from public.inventory_movements
   where transaction_id = p_transaction_id and movement_type = 'usage'
   group by item_id;

  update public.appointment_deposits
     set status = 'held', transaction_id = null, resolved_at = null, resolved_by = null
   where transaction_id = p_transaction_id and status = 'applied';

  update public.transactions
     set status = 'voided', voided_at = now(), voided_by = public.current_staff_id(), void_reason = p_reason
   where id = p_transaction_id;

  if v_tx.client_id is not null then
    update public.clients set total_spent = greatest(total_spent - v_tx.total, 0) where id = v_tx.client_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Inasistencias por cliente
-- ---------------------------------------------------------------------
create or replace function public.client_no_show_count(p_client_id uuid)
returns integer
language sql stable security invoker set search_path = public
as $$
  select count(*)::integer from public.appointments where client_id = p_client_id and status = 'no_show';
$$;

-- ---------------------------------------------------------------------
-- RLS y permisos (escritura solo vía RPC)
-- ---------------------------------------------------------------------
alter table public.appointment_deposits enable row level security;

drop policy if exists deposits_select on public.appointment_deposits;
create policy deposits_select on public.appointment_deposits for select to authenticated using (public.is_staff());

revoke insert, update, delete on public.appointment_deposits from authenticated;
grant select on public.appointment_deposits to authenticated;

revoke execute on function public.record_deposit(uuid, numeric, text, text) from public, anon;
revoke execute on function public.resolve_deposit(uuid, text, text) from public, anon;
revoke execute on function public.client_no_show_count(uuid) from public, anon;
revoke execute on function public.create_sale(jsonb) from public, anon;
revoke execute on function public.void_transaction(uuid, text) from public, anon;
revoke execute on function public.register_summary(uuid) from public, anon;
grant execute on function public.record_deposit(uuid, numeric, text, text) to authenticated;
grant execute on function public.resolve_deposit(uuid, text, text) to authenticated;
grant execute on function public.client_no_show_count(uuid) to authenticated;
grant execute on function public.create_sale(jsonb) to authenticated;
grant execute on function public.void_transaction(uuid, text) to authenticated;
grant execute on function public.register_summary(uuid) to authenticated;
