-- =====================================================================
--  005_multi_service_bookings.sql — Varios servicios en una misma visita
--
--  Una reserva con varios servicios se guarda como varias citas enlazadas por
--  booking_id. Así se conservan intactos el bloqueo de cruces por profesional,
--  la grilla de la agenda y el cálculo de comisiones por servicio.
--  create_sale acepta "appointment_ids" para completar todas las citas cobradas.
--  Re-ejecutable.
-- =====================================================================

alter table public.appointments add column if not exists booking_id uuid;
create index if not exists appointments_booking_idx on public.appointments (booking_id) where booking_id is not null;

-- ---------------------------------------------------------------------
-- Venta atómica (versión con varias citas)
-- ---------------------------------------------------------------------
create or replace function public.create_sale(p_payload jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
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

  -- Citas cobradas: "appointment_ids" (nuevo) + "appointment_id" (compatibilidad)
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

  if jsonb_typeof(p_payload -> 'payments') = 'array' then
    select coalesce(sum((value ->> 'amount')::numeric), 0),
           coalesce(sum((value ->> 'amount')::numeric) filter (where value ->> 'method' = 'cash'), 0)
      into v_paid, v_cash_paid
      from jsonb_array_elements(p_payload -> 'payments');
  end if;

  if round(v_paid, 2) <> round(v_total, 2) then
    raise exception 'Los pagos (%) no coinciden con el total (%)', round(v_paid, 2), round(v_total, 2) using errcode = '22023';
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
    if coalesce((v_pay ->> 'amount')::numeric, 0) > 0 then
      insert into public.transaction_payments (transaction_id, method, amount, reference)
      values (v_tx, v_pay ->> 'method', (v_pay ->> 'amount')::numeric, nullif(v_pay ->> 'reference', ''));
    end if;
  end loop;

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

  return jsonb_build_object('id', v_tx, 'ticket_number', v_ticket, 'total', v_total, 'change', v_change);
end;
$$;

revoke execute on function public.create_sale(jsonb) from public, anon;
grant execute on function public.create_sale(jsonb) to authenticated;
