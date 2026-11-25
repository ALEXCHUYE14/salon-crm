-- =====================================================================
--  009_loyalty_points.sql — Programa de puntos
--
--  · El cliente gana puntos por lo que paga (sin propinas, después de descuentos).
--  · Los puntos se canjean en caja como descuento (los reportes de ingresos ya
--    reflejan el valor otorgado; no hay doble conteo).
--  · Anular la venta revierte los puntos ganados y devuelve los canjeados.
--  · Desactivado por defecto (Ajustes → Fidelización).
--  Re-ejecutable. create_sale / void_transaction siguen siendo SECURITY DEFINER.
-- =====================================================================

alter table public.business_settings
  add column if not exists loyalty_points_enabled boolean not null default false,
  add column if not exists loyalty_points_per_currency numeric(8,2) not null default 1,
  add column if not exists loyalty_point_value numeric(8,4) not null default 0.05,
  add column if not exists loyalty_min_redeem integer not null default 100;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_settings_points_rate_check') then
    alter table public.business_settings add constraint business_settings_points_rate_check
      check (loyalty_points_per_currency >= 0 and loyalty_points_per_currency <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_settings_point_value_check') then
    alter table public.business_settings add constraint business_settings_point_value_check
      check (loyalty_point_value > 0 and loyalty_point_value <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_settings_min_redeem_check') then
    alter table public.business_settings add constraint business_settings_min_redeem_check
      check (loyalty_min_redeem between 1 and 1000000);
  end if;
end;
$$;

alter table public.clients add column if not exists loyalty_points integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_loyalty_points_check') then
    alter table public.clients add constraint clients_loyalty_points_check check (loyalty_points >= 0);
  end if;
end;
$$;

alter table public.transactions
  add column if not exists points_earned integer not null default 0,
  add column if not exists points_redeemed integer not null default 0,
  add column if not exists points_discount numeric(12,2) not null default 0;

create table if not exists public.loyalty_ledger (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null constraint loyalty_ledger_client_fk references public.clients (id) on delete cascade,
  transaction_id  uuid constraint loyalty_ledger_transaction_fk references public.transactions (id) on delete set null,
  kind            text not null check (kind in ('earn', 'redeem', 'reverse', 'adjust')),
  points          integer not null check (points <> 0),
  balance_after   integer not null check (balance_after >= 0),
  description     text,
  created_by      uuid constraint loyalty_ledger_created_by_fk references public.staff_members (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists loyalty_ledger_client_idx on public.loyalty_ledger (client_id, created_at desc);

-- Los puntos no se editan desde la ficha del cliente: solo por estas funciones
create or replace function public.clients_protect_points()
returns trigger
language plpgsql
as $$
begin
  if new.loyalty_points is distinct from old.loyalty_points
     and coalesce(current_setting('app.points_write', true), '') <> 'on' then
    new.loyalty_points := old.loyalty_points;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clients_protect_points on public.clients;
create trigger trg_clients_protect_points
  before update on public.clients
  for each row execute function public.clients_protect_points();

-- Movimiento de puntos (uso interno de las funciones de este archivo)
create or replace function public.loyalty_apply(p_client uuid, p_points integer, p_kind text, p_tx uuid, p_description text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_points = 0 then
    return (select loyalty_points from public.clients where id = p_client);
  end if;
  perform set_config('app.points_write', 'on', true);
  update public.clients set loyalty_points = greatest(0, loyalty_points + p_points)
   where id = p_client
  returning loyalty_points into v_balance;
  perform set_config('app.points_write', 'off', true);
  if v_balance is null then
    return null;
  end if;
  insert into public.loyalty_ledger (client_id, transaction_id, kind, points, balance_after, description, created_by)
  values (p_client, p_tx, p_kind, p_points, v_balance, p_description, public.current_staff_id());
  return v_balance;
end;
$$;

-- Ajuste manual (administración)
create or replace function public.adjust_loyalty_points(p_client_id uuid, p_points integer, p_reason text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_current integer;
begin
  if not public.has_role('owner', 'admin') then
    raise exception 'Solo administración puede ajustar puntos' using errcode = '42501';
  end if;
  if p_points is null or p_points = 0 or abs(p_points) > 1000000 then
    raise exception 'Indica una cantidad de puntos válida' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Indica el motivo del ajuste' using errcode = '22023';
  end if;
  select loyalty_points into v_current from public.clients where id = p_client_id for update;
  if not found then
    raise exception 'Cliente no encontrado' using errcode = 'P0002';
  end if;
  if v_current + p_points < 0 then
    raise exception 'El cliente solo tiene % puntos', v_current using errcode = 'P0001';
  end if;
  return public.loyalty_apply(p_client_id, p_points, 'adjust', null, trim(p_reason));
end;
$$;

-- ---------------------------------------------------------------------
-- Venta: adelantos + puntos
-- ---------------------------------------------------------------------
create or replace function public.create_sale(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  s             public.business_settings;
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
  v_redeem      integer := coalesce((p_payload ->> 'points_redeemed')::integer, 0);
  v_points_val  numeric := 0;
  v_earned      integer := 0;
  v_balance     integer;
begin
  if not public.has_role('owner', 'admin', 'receptionist') then
    raise exception 'No tienes permiso para registrar cobros' using errcode = '42501';
  end if;
  select * into s from public.business_settings limit 1;

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

  -- Canje de puntos: se suma al descuento
  if v_redeem < 0 then
    raise exception 'Cantidad de puntos inválida' using errcode = '22023';
  end if;
  if v_redeem > 0 then
    if not coalesce(s.loyalty_points_enabled, false) then
      raise exception 'El programa de puntos está desactivado' using errcode = 'P0001';
    end if;
    if v_client is null then
      raise exception 'Selecciona al cliente para canjear puntos' using errcode = '22023';
    end if;
    select loyalty_points into v_balance from public.clients where id = v_client for update;
    if coalesce(v_balance, 0) < v_redeem then
      raise exception 'El cliente solo tiene % puntos', coalesce(v_balance, 0) using errcode = 'P0001';
    end if;
    if v_redeem < s.loyalty_min_redeem then
      raise exception 'El canje mínimo es de % puntos', s.loyalty_min_redeem using errcode = 'P0001';
    end if;
    v_points_val := round(v_redeem * s.loyalty_point_value, 2);
    if v_discount + v_points_val > v_subtotal then
      raise exception 'El canje (%) supera el monto a pagar (%)', v_points_val, v_subtotal - v_discount using errcode = 'P0001';
    end if;
    v_discount := v_discount + v_points_val;
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

  -- Puntos ganados: sobre lo pagado sin propina
  if coalesce(s.loyalty_points_enabled, false) and v_client is not null then
    v_earned := floor(greatest(v_subtotal - v_discount, 0) * s.loyalty_points_per_currency)::integer;
  end if;

  insert into public.transactions (
    cash_register_id, client_id, appointment_id, created_by, tip_staff_id,
    subtotal, discount_amount, tip_amount, total, cash_received, change_given, notes,
    points_earned, points_redeemed, points_discount
  ) values (
    v_register, v_client, v_appointment, public.current_staff_id(), case when v_tip > 0 then v_tip_staff end,
    v_subtotal, v_discount, v_tip, v_total, v_cash_recv, v_change, nullif(p_payload ->> 'notes', ''),
    v_earned, v_redeem, v_points_val
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
    if v_redeem > 0 then
      perform public.loyalty_apply(v_client, -v_redeem, 'redeem', v_tx, 'Canje en ticket #' || v_ticket);
    end if;
    if v_earned > 0 then
      v_balance := public.loyalty_apply(v_client, v_earned, 'earn', v_tx, 'Compra ticket #' || v_ticket);
    end if;
    select loyalty_points into v_balance from public.clients where id = v_client;
  end if;

  return jsonb_build_object(
    'id', v_tx, 'ticket_number', v_ticket, 'total', v_total, 'change', v_change, 'deposits', v_dep_total,
    'points_earned', v_earned, 'points_redeemed', v_redeem, 'points_balance', v_balance
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Anulación: también revierte puntos
-- ---------------------------------------------------------------------
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

  if v_tx.client_id is not null then
    if v_tx.points_earned > 0 then
      perform public.loyalty_apply(v_tx.client_id, -v_tx.points_earned, 'reverse', v_tx.id, 'Anulación ticket #' || v_tx.ticket_number);
    end if;
    if v_tx.points_redeemed > 0 then
      perform public.loyalty_apply(v_tx.client_id, v_tx.points_redeemed, 'reverse', v_tx.id, 'Devolución de canje, ticket #' || v_tx.ticket_number);
    end if;
  end if;

  update public.transactions
     set status = 'voided', voided_at = now(), voided_by = public.current_staff_id(), void_reason = p_reason
   where id = p_transaction_id;

  if v_tx.client_id is not null then
    update public.clients set total_spent = greatest(total_spent - v_tx.total, 0) where id = v_tx.client_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------
alter table public.loyalty_ledger enable row level security;
drop policy if exists loyalty_ledger_select on public.loyalty_ledger;
create policy loyalty_ledger_select on public.loyalty_ledger for select to authenticated using (public.is_staff());
revoke insert, update, delete on public.loyalty_ledger from authenticated;
grant select on public.loyalty_ledger to authenticated;

revoke execute on function public.loyalty_apply(uuid, integer, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.adjust_loyalty_points(uuid, integer, text) from public, anon;
grant execute on function public.adjust_loyalty_points(uuid, integer, text) to authenticated;
revoke execute on function public.create_sale(jsonb) from public, anon;
grant execute on function public.create_sale(jsonb) to authenticated;
revoke execute on function public.void_transaction(uuid, text) from public, anon;
grant execute on function public.void_transaction(uuid, text) to authenticated;
