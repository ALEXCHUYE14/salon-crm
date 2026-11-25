-- =====================================================================
--  aplicar-mejoras-003-a-016.sql
--  Todas las mejoras en orden, en un solo archivo para el SQL Editor de Supabase.
--  Requisito: 001 y 002 ya aplicadas. Es seguro volver a ejecutarlo completo.
--  (Generado a partir de supabase/migrations/003..016; si usas la CLI de
--   Supabase, usa la carpeta migrations y no este archivo.)
-- =====================================================================



-- >>>>>>>>>>>>>>>>>>>> 003_cash_movements.sql <<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>> 004_staff_time_off.sql <<<<<<<<<<<<<<<<<<<<

-- =====================================================================
--  004_staff_time_off.sql — Bloqueos y ausencias del personal
--
--  · Vacaciones, descanso médico, almuerzo, salida temprana, capacitación…
--  · La base de datos impide agendar (o mover) una cita sobre un bloqueo.
--  · Los especialistas pueden gestionar sus propios bloqueos; recepción y
--    administración, los de todo el equipo.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.staff_time_off (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null constraint staff_time_off_staff_fk references public.staff_members (id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  kind        text not null default 'personal'
              check (kind in ('vacation', 'sick', 'break', 'personal', 'training', 'other')),
  reason      text check (reason is null or char_length(reason) <= 200),
  created_by  uuid constraint staff_time_off_created_by_fk references public.staff_members (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint staff_time_off_order  check (ends_at > starts_at),
  constraint staff_time_off_length check (ends_at - starts_at <= interval '370 days')
);
create index if not exists staff_time_off_staff_idx on public.staff_time_off (staff_id, starts_at);
create index if not exists staff_time_off_range_idx on public.staff_time_off using gist (tstzrange(starts_at, ends_at, '[)'));

drop trigger if exists trg_staff_time_off_updated_at on public.staff_time_off;
create trigger trg_staff_time_off_updated_at
  before update on public.staff_time_off
  for each row execute function public.set_updated_at();

create or replace function public.staff_time_off_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.reason := nullif(trim(coalesce(new.reason, '')), '');
  if tg_op = 'INSERT' then
    new.created_by := public.current_staff_id();
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_staff_time_off_before_write on public.staff_time_off;
create trigger trg_staff_time_off_before_write
  before insert or update on public.staff_time_off
  for each row execute function public.staff_time_off_before_write();

-- ---------------------------------------------------------------------
-- Citas: no se pueden agendar sobre un bloqueo del profesional.
-- Se ejecuta DESPUÉS de trg_appointments_before_write (orden alfabético),
-- cuando ends_at ya está calculado.
-- ---------------------------------------------------------------------
create or replace function public.appointments_check_time_off()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_block public.staff_time_off;
begin
  -- Una cita cancelada/no asistida no ocupa el horario; una completada ya ocurrió (no debe bloquear un cobro)
  if new.status in ('cancelled', 'no_show', 'completed') then
    return new;
  end if;

  -- Solo se valida al crear, al mover/cambiar de profesional o al reactivar una cita
  if tg_op = 'UPDATE'
     and new.staff_id = old.staff_id
     and new.starts_at = old.starts_at
     and new.ends_at = old.ends_at
     and old.status not in ('cancelled', 'no_show') then
    return new;
  end if;

  select * into v_block
    from public.staff_time_off b
   where b.staff_id = new.staff_id
     and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
   order by b.starts_at
   limit 1;

  if found then
    raise exception '%', format(
      'El profesional no está disponible: tiene un bloqueo de %s a %s%s',
      to_char(v_block.starts_at at time zone public.business_tz(), 'DD/MM HH24:MI'),
      to_char(v_block.ends_at at time zone public.business_tz(), 'DD/MM HH24:MI'),
      coalesce(' (' || v_block.reason || ')', '')
    ) using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_appointments_time_off_check on public.appointments;
create trigger trg_appointments_time_off_check
  before insert or update on public.appointments
  for each row execute function public.appointments_check_time_off();

-- ---------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------
alter table public.staff_time_off enable row level security;

drop policy if exists time_off_select on public.staff_time_off;
drop policy if exists time_off_insert on public.staff_time_off;
drop policy if exists time_off_update on public.staff_time_off;
drop policy if exists time_off_delete on public.staff_time_off;

create policy time_off_select on public.staff_time_off for select to authenticated using (public.is_staff());
create policy time_off_insert on public.staff_time_off for insert to authenticated
  with check (public.has_role('owner', 'admin', 'receptionist') or staff_id = public.current_staff_id());
create policy time_off_update on public.staff_time_off for update to authenticated
  using (public.has_role('owner', 'admin', 'receptionist') or staff_id = public.current_staff_id())
  with check (public.has_role('owner', 'admin', 'receptionist') or staff_id = public.current_staff_id());
create policy time_off_delete on public.staff_time_off for delete to authenticated
  using (public.has_role('owner', 'admin', 'receptionist') or staff_id = public.current_staff_id());

grant select, insert, update, delete on public.staff_time_off to authenticated;

-- Realtime para que la agenda refleje los bloqueos al instante
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.staff_time_off;
    exception when duplicate_object then
      null;
    end;
  end if;
end;
$$;


-- >>>>>>>>>>>>>>>>>>>> 005_multi_service_bookings.sql <<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>> 006_online_booking.sql <<<<<<<<<<<<<<<<<<<<

-- =====================================================================
--  006_online_booking.sql — Reserva online pública (/reservar)
--
--  Seguridad: el visitante anónimo NO tiene acceso a ninguna tabla. Solo puede
--  ejecutar tres funciones SECURITY DEFINER que validan todo:
--    · public_booking_info()          → datos públicos del negocio y catálogo reservable
--    · public_available_slots(...)    → horarios libres reales
--    · public_create_booking(payload) → crea la cita (origen "online")
--  Antispam: máx. 3 reservas online pendientes por teléfono y tope global por hora.
--  La reserva online está DESACTIVADA por defecto (Ajustes → Reserva online).
--  Re-ejecutable.
-- =====================================================================

alter table public.business_settings
  add column if not exists online_booking_enabled boolean not null default false,
  add column if not exists online_booking_days_ahead integer not null default 30,
  add column if not exists online_booking_min_notice_minutes integer not null default 60,
  add column if not exists online_booking_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_settings_online_days_check') then
    alter table public.business_settings add constraint business_settings_online_days_check
      check (online_booking_days_ahead between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_settings_online_notice_check') then
    alter table public.business_settings add constraint business_settings_online_notice_check
      check (online_booking_min_notice_minutes between 0 and 10080);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'business_settings_online_note_check') then
    alter table public.business_settings add constraint business_settings_online_note_check
      check (online_booking_note is null or char_length(online_booking_note) <= 300);
  end if;
end;
$$;

alter table public.services add column if not exists online_bookable boolean not null default true;

-- ---------------------------------------------------------------------
-- Utilidades internas
-- ---------------------------------------------------------------------

-- ¿Puede este profesional atender este segmento de servicio?
create or replace function public.staff_can_serve(p_specialty text, p_segment text)
returns boolean
language sql immutable
as $$
  select case
    when p_specialty = 'none' then false
    when p_segment = 'both' or p_specialty = 'both' then true
    when p_segment = 'barbershop' then p_specialty = 'barber'
    when p_segment = 'beauty_salon' then p_specialty = 'stylist'
    else false
  end;
$$;

-- ¿El segmento es visible según el modo operativo del negocio?
create or replace function public.segment_visible(p_segment text, p_mode text)
returns boolean
language sql immutable
as $$
  select case p_mode
    when 'barbershop' then p_segment in ('barbershop', 'both')
    when 'beauty_salon' then p_segment in ('beauty_salon', 'both')
    else true
  end;
$$;

-- Nombre público del profesional: "Carlos M."
create or replace function public.public_staff_name(p_full_name text)
returns text
language sql immutable
as $$
  select case
    when array_length(regexp_split_to_array(trim(p_full_name), '\s+'), 1) > 1
      then split_part(trim(p_full_name), ' ', 1) || ' ' ||
           left((regexp_split_to_array(trim(p_full_name), '\s+'))[2], 1) || '.'
    else trim(p_full_name)
  end;
$$;

-- ---------------------------------------------------------------------
-- 1) Información pública
-- ---------------------------------------------------------------------
create or replace function public.public_booking_info()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  s public.business_settings;
begin
  select * into s from public.business_settings limit 1;
  if not found then
    return jsonb_build_object('enabled', false);
  end if;
  if not s.online_booking_enabled then
    return jsonb_build_object('enabled', false, 'business_name', s.business_name, 'phone', s.phone);
  end if;

  return jsonb_build_object(
    'enabled', true,
    'business_name', s.business_name,
    'slogan', s.slogan,
    'logo_url', s.logo_url,
    'phone', s.phone,
    'address', s.address,
    'timezone', s.timezone,
    'currency_symbol', s.currency_symbol,
    'locale', s.locale,
    'days_ahead', s.online_booking_days_ahead,
    'min_notice_minutes', s.online_booking_min_notice_minutes,
    'note', s.online_booking_note,
    'business_hours', s.business_hours,
    'today', (now() at time zone s.timezone)::date,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name)
        from public.service_categories c
       where c.is_active and public.segment_visible(c.segment, s.operating_mode)
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.name, 'description', v.description, 'category_id', v.category_id,
               'segment', v.segment, 'duration_minutes', v.duration_minutes + v.processing_minutes, 'price', v.price)
             order by v.sort_order, v.name)
        from public.services v
       where v.is_active and v.online_bookable and public.segment_visible(v.segment, s.operating_mode)
         and exists (select 1 from public.staff_members m
                      where m.is_active and m.is_bookable and public.staff_can_serve(m.specialty, v.segment))
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'name', public.public_staff_name(m.full_name), 'specialty', m.specialty, 'color', m.color)
             order by m.full_name)
        from public.staff_members m
       where m.is_active and m.is_bookable and m.specialty <> 'none'
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 2) Horarios disponibles de un día
-- ---------------------------------------------------------------------
create or replace function public.public_available_slots(p_service_id uuid, p_date date, p_staff_id uuid default null)
returns table (slot_time text, staff_id uuid)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  s           public.business_settings;
  v_service   public.services;
  v_tz        text;
  v_today     date;
  v_total     integer;
  v_interval  integer;
  v_earliest  timestamptz;
  v_dow       integer;
  v_bh        jsonb;
begin
  select * into s from public.business_settings limit 1;
  if not found or not s.online_booking_enabled then
    return;
  end if;
  v_tz := s.timezone;
  v_today := (now() at time zone v_tz)::date;
  if p_date is null or p_date < v_today or p_date > v_today + s.online_booking_days_ahead then
    return;
  end if;

  select * into v_service from public.services
   where id = p_service_id and is_active and online_bookable and public.segment_visible(segment, s.operating_mode);
  if not found then
    return;
  end if;

  v_total    := v_service.duration_minutes + v_service.processing_minutes;
  v_interval := s.slot_interval_minutes;
  v_earliest := now() + make_interval(mins => s.online_booking_min_notice_minutes);
  v_dow      := extract(dow from p_date)::integer;

  select value into v_bh from jsonb_array_elements(s.business_hours) where (value ->> 'day')::integer = v_dow limit 1;
  if v_bh is null or coalesce((v_bh ->> 'open')::boolean, false) = false then
    return;
  end if;

  return query
  with staff as (
    select m.id, m.full_name,
           -- Ventana de trabajo: turno del profesional ∩ horario del negocio (sin turno definido = horario del negocio)
           greatest((v_bh ->> 'start')::time, coalesce((ws ->> 'start')::time, (v_bh ->> 'start')::time)) as w_start,
           least((v_bh ->> 'end')::time, coalesce((ws ->> 'end')::time, (v_bh ->> 'end')::time)) as w_end
      from public.staff_members m
      left join lateral (
        select value as ws from jsonb_array_elements(m.work_schedule)
         where (value ->> 'day')::integer = v_dow limit 1
      ) w on true
     where m.is_active and m.is_bookable
       and public.staff_can_serve(m.specialty, v_service.segment)
       and (p_staff_id is null or m.id = p_staff_id)
       -- Si tiene turnos definidos y ninguno es para este día, no trabaja
       and (jsonb_array_length(m.work_schedule) = 0 or w.ws is not null)
  ),
  candidates as (
    select st.id as staff_id, st.full_name,
           ((p_date::timestamp + st.w_start) + make_interval(mins => g.n * v_interval)) at time zone v_tz as starts_at
      from staff st
      cross join lateral generate_series(
        0, greatest(-1, floor((extract(epoch from (st.w_end - st.w_start)) / 60 - v_total) / v_interval)::integer)
      ) as g(n)
     where st.w_end > st.w_start
  ),
  free as (
    select c.staff_id, c.full_name, c.starts_at
      from candidates c
     where c.starts_at >= v_earliest
       and not exists (
         select 1 from public.appointments a
          where a.staff_id = c.staff_id
            and a.status not in ('cancelled', 'no_show')
            and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(c.starts_at, c.starts_at + make_interval(mins => v_total), '[)')
       )
       and not exists (
         select 1 from public.staff_time_off b
          where b.staff_id = c.staff_id
            and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(c.starts_at, c.starts_at + make_interval(mins => v_total), '[)')
       )
  ),
  load as (
    -- Carga del día por profesional, para repartir las reservas "sin preferencia"
    select f.staff_id, (
      select count(*) from public.appointments a
       where a.staff_id = f.staff_id and a.status not in ('cancelled', 'no_show')
         and a.starts_at >= (p_date::timestamp at time zone v_tz) and a.starts_at < ((p_date + 1)::timestamp at time zone v_tz)
    ) as n
      from (select distinct staff_id from free) f
  )
  select distinct on (f.starts_at)
         to_char(f.starts_at at time zone v_tz, 'HH24:MI'), f.staff_id
    from free f
    join load l on l.staff_id = f.staff_id
   order by f.starts_at, l.n, f.full_name;
end;
$$;

-- ---------------------------------------------------------------------
-- 3) Crear la reserva
-- ---------------------------------------------------------------------
create or replace function public.public_create_booking(p_payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  s            public.business_settings;
  v_service    public.services;
  v_tz         text;
  v_date       date;
  v_time       text := p_payload ->> 'time';
  v_staff_req  uuid;
  v_staff      uuid;
  v_name       text := trim(coalesce(p_payload ->> 'name', ''));
  v_phone_raw  text := trim(coalesce(p_payload ->> 'phone', ''));
  v_phone      text;
  v_email      text := nullif(lower(trim(coalesce(p_payload ->> 'email', ''))), '');
  v_notes      text := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  v_client     uuid;
  v_appt       uuid;
  v_starts     timestamptz;
  v_staff_name text;
begin
  select * into s from public.business_settings limit 1;
  if not found or not s.online_booking_enabled then
    raise exception 'La reserva online no está disponible en este momento' using errcode = 'P0001';
  end if;
  v_tz := s.timezone;

  -- Validación de datos de contacto
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Escribe tu nombre (entre 2 y 80 caracteres)' using errcode = '22023';
  end if;
  v_phone := regexp_replace(v_phone_raw, '\D', '', 'g');
  if char_length(v_phone) < 6 or char_length(v_phone) > 15 then
    raise exception 'Escribe un teléfono válido' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'El correo no es válido' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 300 then
    raise exception 'El comentario no puede superar 300 caracteres' using errcode = '22023';
  end if;
  if v_time is null or v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Elige un horario' using errcode = '22023';
  end if;
  begin
    v_date := (p_payload ->> 'date')::date;
    v_staff_req := nullif(p_payload ->> 'staff_id', '')::uuid;
    select * into v_service from public.services where id = (p_payload ->> 'service_id')::uuid;
  exception when others then
    raise exception 'Datos de reserva inválidos' using errcode = '22023';
  end;
  if v_service.id is null or not v_service.is_active or not v_service.online_bookable then
    raise exception 'El servicio elegido no está disponible' using errcode = 'P0001';
  end if;

  -- Antispam: reservas online pendientes por teléfono y tope global
  if (select count(*) from public.appointments a
        join public.clients c on c.id = a.client_id
       where a.source = 'online' and a.status in ('scheduled', 'confirmed') and a.starts_at > now()
         and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 9) = right(v_phone, 9)) >= 3 then
    raise exception 'Ya tienes 3 reservas pendientes. Escríbenos si necesitas otra cita.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.appointments where source = 'online' and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Estamos recibiendo muchas reservas. Inténtalo en unos minutos.' using errcode = 'P0001';
  end if;

  -- El horario debe seguir libre (misma regla que la lista de horarios)
  select f.staff_id into v_staff
    from public.public_available_slots(v_service.id, v_date, v_staff_req) f
   where f.slot_time = v_time
   limit 1;
  if v_staff is null then
    raise exception 'Ese horario ya no está disponible. Elige otro, por favor.' using errcode = 'P0001';
  end if;
  v_starts := (v_date::timestamp + v_time::time) at time zone v_tz;

  -- Cliente: se reutiliza la ficha por teléfono (últimos 9 dígitos) o se crea una nueva
  select id into v_client from public.clients
   where is_active and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(v_phone, 9)
   order by updated_at desc
   limit 1;
  if v_client is null then
    insert into public.clients (full_name, phone, email, segment, notes, tags)
    values (v_name, v_phone, v_email, v_service.segment, 'Registrado desde la reserva online', '{online}')
    returning id into v_client;
  end if;

  begin
    insert into public.appointments (client_id, staff_id, service_id, starts_at, status, source, notes)
    values (v_client, v_staff, v_service.id, v_starts, 'scheduled', 'online',
            case when v_notes is not null then 'Reserva online: ' || v_notes else 'Reserva online' end)
    returning id into v_appt;
  exception
    when exclusion_violation or raise_exception then
      raise exception 'Ese horario acaba de ser reservado. Elige otro, por favor.' using errcode = 'P0001';
  end;

  select public.public_staff_name(full_name) into v_staff_name from public.staff_members where id = v_staff;

  return jsonb_build_object(
    'reference', upper(left(replace(v_appt::text, '-', ''), 8)),
    'service', v_service.name,
    'staff', v_staff_name,
    'date', v_date,
    'time', v_time,
    'duration_minutes', v_service.duration_minutes + v_service.processing_minutes,
    'price', v_service.price
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Permisos: solo estas funciones quedan expuestas al público
-- ---------------------------------------------------------------------
revoke execute on function public.public_booking_info() from public;
revoke execute on function public.public_available_slots(uuid, date, uuid) from public;
revoke execute on function public.public_create_booking(jsonb) from public;
grant execute on function public.public_booking_info() to anon, authenticated;
grant execute on function public.public_available_slots(uuid, date, uuid) to anon, authenticated;
grant execute on function public.public_create_booking(jsonb) to anon, authenticated;

-- Utilidades: inmutables y sin datos sensibles; no hace falta exponerlas
revoke execute on function public.staff_can_serve(text, text) from public, anon;
revoke execute on function public.segment_visible(text, text) from public, anon;
revoke execute on function public.public_staff_name(text) from public, anon;
grant execute on function public.staff_can_serve(text, text) to authenticated;
grant execute on function public.segment_visible(text, text) to authenticated;
grant execute on function public.public_staff_name(text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> 007_service_supplies.sql <<<<<<<<<<<<<<<<<<<<

-- =====================================================================
--  007_service_supplies.sql — Recetas: insumos que consume cada servicio
--
--  · Al cobrar un servicio se descuenta automáticamente su receta del inventario
--    (movimiento "usage" ligado al ticket).
--  · Un combo sin receta propia consume la receta de sus servicios componentes.
--  · Si el stock registrado no alcanza, NO se bloquea el cobro: se descuenta lo
--    disponible y se anota el faltante en el movimiento (aparecerá en stock bajo).
--  · Al anular la venta, los insumos consumidos vuelven al inventario.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.service_supplies (
  service_id  uuid not null constraint service_supplies_service_fk references public.services (id) on delete cascade,
  item_id     uuid not null constraint service_supplies_item_fk references public.inventory_items (id) on delete restrict,
  quantity    numeric(12,2) not null check (quantity > 0 and quantity <= 10000),
  primary key (service_id, item_id)
);
create index if not exists service_supplies_item_idx on public.service_supplies (item_id);

-- ---------------------------------------------------------------------
-- Ítems de venta: productos descuentan stock; servicios consumen su receta
-- ---------------------------------------------------------------------
create or replace function public.transaction_items_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ticket bigint;
  r        record;
  v_stock  numeric;
  v_use    numeric;
begin
  if new.item_kind = 'product' then
    insert into public.inventory_movements (item_id, movement_type, quantity, unit_cost, reference, transaction_id, staff_id, created_by)
    select new.inventory_item_id, 'sale', new.quantity, i.cost, 'Venta POS', new.transaction_id, new.staff_id, public.current_staff_id()
      from public.inventory_items i
     where i.id = new.inventory_item_id;
    return new;
  end if;

  if new.item_kind <> 'service' or new.service_id is null then
    return new;
  end if;

  select ticket_number into v_ticket from public.transactions where id = new.transaction_id;

  for r in
    with own as (
      select ss.item_id, ss.quantity from public.service_supplies ss where ss.service_id = new.service_id
    ),
    from_combo as (
      -- Combo sin receta propia: suma las recetas de sus componentes
      select ss.item_id, sum(ss.quantity * ci.quantity) as quantity
        from public.service_combo_items ci
        join public.service_supplies ss on ss.service_id = ci.service_id
       where ci.combo_id = new.service_id and not exists (select 1 from own)
       group by ss.item_id
    )
    select x.item_id, sum(x.quantity) * new.quantity as needed
      from (select * from own union all select * from from_combo) x
     group by x.item_id
  loop
    select stock into v_stock from public.inventory_items where id = r.item_id for update;
    if not found then
      continue;
    end if;
    v_use := round(least(coalesce(v_stock, 0), r.needed), 2);
    if v_use > 0 then
      insert into public.inventory_movements (item_id, movement_type, quantity, reference, transaction_id, staff_id, notes, created_by)
      values (
        r.item_id, 'usage', v_use,
        'Consumo por servicio · Ticket #' || coalesce(v_ticket::text, '?'),
        new.transaction_id, new.staff_id,
        case when v_use < r.needed then format('Stock insuficiente: faltaron %s', round(r.needed - v_use, 2)) end,
        public.current_staff_id()
      );
    end if;
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Anulación: además de productos, devuelve los insumos consumidos
-- ---------------------------------------------------------------------
create or replace function public.void_transaction(p_transaction_id uuid, p_reason text)
returns void
language plpgsql security invoker set search_path = public
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

  -- Insumos consumidos por los servicios del ticket
  insert into public.inventory_movements (item_id, movement_type, quantity, reference, transaction_id, notes)
  select item_id, 'return', sum(quantity), 'Anulación ticket #' || v_tx.ticket_number || ' (insumos)', v_tx.id, p_reason
    from public.inventory_movements
   where transaction_id = p_transaction_id and movement_type = 'usage'
   group by item_id;

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
alter table public.service_supplies enable row level security;

drop policy if exists service_supplies_select on public.service_supplies;
drop policy if exists service_supplies_write on public.service_supplies;

create policy service_supplies_select on public.service_supplies for select to authenticated using (public.is_staff());
create policy service_supplies_write on public.service_supplies for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));

grant select, insert, update, delete on public.service_supplies to authenticated;

revoke execute on function public.void_transaction(uuid, text) from public, anon;
grant execute on function public.void_transaction(uuid, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> 008_deposits_no_show.sql <<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>> 009_loyalty_points.sql <<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>> 010_prepaid_plans.sql <<<<<<<<<<<<<<<<<<<<

-- =====================================================================
--  010_prepaid_plans.sql — Paquetes de sesiones y gift cards
--
--  Contabilidad (base caja, sin doble conteo):
--   · Vender un paquete/gift card = ingreso del día (ítem "plan" del ticket).
--   · Usar una sesión de paquete  = servicio a precio 0 para el cliente, pero la
--                                   comisión del profesional se calcula sobre el
--                                   precio normal (trabajó igual).
--   · Usar saldo de gift card     = descuento del ticket (ya se cobró al venderla).
--   · Anular                      = devuelve sesiones/saldo; un paquete ya usado no
--                                   permite anular la venta en que se compró.
--  Re-ejecutable. create_sale / void_transaction siguen siendo SECURITY DEFINER.
-- =====================================================================

create table if not exists public.prepaid_plans (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(trim(name)) between 2 and 120),
  kind           text not null check (kind in ('package', 'gift_card')),
  service_id     uuid constraint prepaid_plans_service_fk references public.services (id) on delete restrict,
  sessions       integer check (sessions between 1 and 100),
  credit         numeric(12,2) check (credit > 0 and credit <= 100000),
  price          numeric(12,2) not null check (price >= 0 and price <= 100000),
  validity_days  integer check (validity_days between 1 and 1095),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint prepaid_plans_shape check (
    (kind = 'package' and service_id is not null and sessions is not null and credit is null) or
    (kind = 'gift_card' and credit is not null and service_id is null and sessions is null)
  )
);

drop trigger if exists trg_prepaid_plans_updated_at on public.prepaid_plans;
create trigger trg_prepaid_plans_updated_at before update on public.prepaid_plans
  for each row execute function public.set_updated_at();

create table if not exists public.client_prepaids (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  client_id            uuid not null constraint client_prepaids_client_fk references public.clients (id) on delete restrict,
  plan_id              uuid constraint client_prepaids_plan_fk references public.prepaid_plans (id) on delete set null,
  kind                 text not null check (kind in ('package', 'gift_card')),
  name                 text not null,
  service_id           uuid constraint client_prepaids_service_fk references public.services (id) on delete set null,
  sessions_total       integer not null default 0 check (sessions_total >= 0),
  sessions_used        integer not null default 0 check (sessions_used >= 0),
  initial_credit       numeric(12,2) not null default 0 check (initial_credit >= 0),
  balance              numeric(12,2) not null default 0 check (balance >= 0),
  expires_at           timestamptz,
  status               text not null default 'active' check (status in ('active', 'cancelled')),
  sale_transaction_id  uuid constraint client_prepaids_sale_fk references public.transactions (id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint client_prepaids_sessions check (sessions_used <= sessions_total),
  constraint client_prepaids_balance check (balance <= initial_credit)
);
create index if not exists client_prepaids_client_idx on public.client_prepaids (client_id, status);
create index if not exists client_prepaids_sale_idx on public.client_prepaids (sale_transaction_id);

create table if not exists public.prepaid_usages (
  id              uuid primary key default gen_random_uuid(),
  prepaid_id      uuid not null constraint prepaid_usages_prepaid_fk references public.client_prepaids (id) on delete cascade,
  transaction_id  uuid not null constraint prepaid_usages_transaction_fk references public.transactions (id) on delete cascade,
  sessions        integer not null default 0 check (sessions >= 0),
  amount          numeric(12,2) not null default 0 check (amount >= 0),
  reversed        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists prepaid_usages_tx_idx on public.prepaid_usages (transaction_id);
create index if not exists prepaid_usages_prepaid_idx on public.prepaid_usages (prepaid_id);

-- Ítems de venta: nuevo tipo "plan" y sesiones de paquete
alter table public.transaction_items add column if not exists plan_id uuid constraint transaction_items_plan_fk references public.prepaid_plans (id) on delete restrict;
alter table public.transaction_items add column if not exists prepaid_id uuid constraint transaction_items_prepaid_fk references public.client_prepaids (id) on delete set null;
alter table public.transaction_items drop constraint if exists transaction_items_item_kind_check;
alter table public.transaction_items add constraint transaction_items_item_kind_check check (item_kind in ('service', 'product', 'plan'));
alter table public.transaction_items drop constraint if exists transaction_items_kind_ref;
alter table public.transaction_items add constraint transaction_items_kind_ref check (
  (item_kind = 'service' and service_id is not null and inventory_item_id is null and plan_id is null) or
  (item_kind = 'product' and inventory_item_id is not null and service_id is null and plan_id is null) or
  (item_kind = 'plan' and plan_id is not null and service_id is null and inventory_item_id is null)
);

alter table public.transactions
  add column if not exists credit_amount numeric(12,2) not null default 0,
  add column if not exists credit_prepaid_id uuid constraint transactions_credit_prepaid_fk references public.client_prepaids (id) on delete set null;

-- ---------------------------------------------------------------------
-- Comisión: planes sin comisión; sesiones de paquete sobre el precio normal
-- ---------------------------------------------------------------------
create or replace function public.transaction_items_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_type          text;
  v_value         numeric;
  v_staff_type    text;
  v_staff_value   numeric;
  v_staff_product numeric;
  v_default_type  text;
  v_default_value numeric;
  v_default_prod  numeric;
  v_base          numeric;
begin
  new.line_total := round(new.quantity * new.unit_price - coalesce(new.discount, 0), 2);
  if new.line_total < 0 then
    raise exception 'El descuento de la línea "%" excede su importe', new.description using errcode = '22023';
  end if;

  if new.staff_id is null or new.item_kind = 'plan' then
    new.commission_type   := null;
    new.commission_value  := 0;
    new.commission_amount := 0;
    return new;
  end if;

  select commission_type, commission_value, product_commission_rate
    into v_staff_type, v_staff_value, v_staff_product
    from public.staff_members where id = new.staff_id;

  select default_commission_type, default_commission_value, product_commission_rate
    into v_default_type, v_default_value, v_default_prod
    from public.business_settings limit 1;

  if new.item_kind = 'service' then
    select s.commission_type, s.commission_value into v_type, v_value
      from public.services s where s.id = new.service_id;
    if v_type is null then
      v_type := v_staff_type;
      v_value := v_staff_value;
    end if;
    if v_type is null then
      v_type := coalesce(v_default_type, 'percentage');
      v_value := coalesce(v_default_value, 0);
    end if;
  else
    v_type := 'percentage';
    v_value := coalesce(v_staff_product, v_default_prod, 0);
  end if;

  -- Sesión de paquete: el cliente no paga ahora, pero la comisión es sobre el precio normal
  v_base := case when new.prepaid_id is not null then round(new.quantity * new.unit_price, 2) else new.line_total end;

  new.commission_type  := v_type;
  new.commission_value := coalesce(v_value, 0);
  new.commission_amount := case
    when v_type = 'fixed' then round(coalesce(v_value, 0) * new.quantity, 2)
    else round(v_base * coalesce(v_value, 0) / 100, 2)
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Ítems: productos (stock), servicios (receta) y planes (crea el prepago)
-- ---------------------------------------------------------------------
create or replace function public.transaction_items_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ticket bigint;
  v_client uuid;
  r        record;
  v_stock  numeric;
  v_use    numeric;
  v_plan   public.prepaid_plans;
  v_code   text;
  i        integer;
begin
  if new.item_kind = 'product' then
    insert into public.inventory_movements (item_id, movement_type, quantity, unit_cost, reference, transaction_id, staff_id, created_by)
    select new.inventory_item_id, 'sale', new.quantity, i.cost, 'Venta POS', new.transaction_id, new.staff_id, public.current_staff_id()
      from public.inventory_items i
     where i.id = new.inventory_item_id;
    return new;
  end if;

  select ticket_number, client_id into v_ticket, v_client from public.transactions where id = new.transaction_id;

  if new.item_kind = 'plan' then
    select * into v_plan from public.prepaid_plans where id = new.plan_id;
    if not found or not v_plan.is_active then
      raise exception 'El paquete o gift card "%" no está disponible', new.description using errcode = 'P0001';
    end if;
    if v_client is null then
      raise exception 'Selecciona al cliente para vender "%"', v_plan.name using errcode = '22023';
    end if;
    if new.quantity <> trunc(new.quantity) or new.quantity < 1 or new.quantity > 10 then
      raise exception 'La cantidad de "%" debe ser un número entero entre 1 y 10', v_plan.name using errcode = '22023';
    end if;
    for i in 1..new.quantity::integer loop
      loop
        v_code := upper(encode(extensions.gen_random_bytes(5), 'hex'));
        exit when not exists (select 1 from public.client_prepaids where code = v_code);
      end loop;
      insert into public.client_prepaids (
        code, client_id, plan_id, kind, name, service_id, sessions_total, initial_credit, balance, expires_at, sale_transaction_id
      ) values (
        v_code, v_client, v_plan.id, v_plan.kind, v_plan.name, v_plan.service_id,
        coalesce(v_plan.sessions, 0), coalesce(v_plan.credit, 0), coalesce(v_plan.credit, 0),
        case when v_plan.validity_days is not null then now() + make_interval(days => v_plan.validity_days) end,
        new.transaction_id
      );
    end loop;
    return new;
  end if;

  if new.item_kind <> 'service' or new.service_id is null then
    return new;
  end if;

  for r in
    with own as (
      select ss.item_id, ss.quantity from public.service_supplies ss where ss.service_id = new.service_id
    ),
    from_combo as (
      select ss.item_id, sum(ss.quantity * ci.quantity) as quantity
        from public.service_combo_items ci
        join public.service_supplies ss on ss.service_id = ci.service_id
       where ci.combo_id = new.service_id and not exists (select 1 from own)
       group by ss.item_id
    )
    select x.item_id, sum(x.quantity) * new.quantity as needed
      from (select * from own union all select * from from_combo) x
     group by x.item_id
  loop
    select stock into v_stock from public.inventory_items where id = r.item_id for update;
    if not found then
      continue;
    end if;
    v_use := round(least(coalesce(v_stock, 0), r.needed), 2);
    if v_use > 0 then
      insert into public.inventory_movements (item_id, movement_type, quantity, reference, transaction_id, staff_id, notes, created_by)
      values (
        r.item_id, 'usage', v_use,
        'Consumo por servicio · Ticket #' || coalesce(v_ticket::text, '?'),
        new.transaction_id, new.staff_id,
        case when v_use < r.needed then format('Stock insuficiente: faltaron %s', round(r.needed - v_use, 2)) end,
        public.current_staff_id()
      );
    end if;
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Venta: adelantos + puntos + sesiones de paquete + gift card
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
  v_items       jsonb := '[]'::jsonb;
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
  v_pkg         record;
  v_prepaid     public.client_prepaids;
  v_gc_code     text := nullif(upper(trim(coalesce(p_payload ->> 'gift_card_code', ''))), '');
  v_gc_amount   numeric := round(coalesce((p_payload ->> 'gift_card_amount')::numeric, 0), 2);
  v_gc          public.client_prepaids;
  v_created     jsonb;
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

  -- Sesiones de paquete: validación por paquete (cliente, servicio, saldo y vigencia)
  for v_pkg in
    select (value ->> 'prepaid_id')::uuid as prepaid_id, (value ->> 'service_id')::uuid as service_id, sum((value ->> 'quantity')::numeric) as qty
      from jsonb_array_elements(p_payload -> 'items')
     where nullif(value ->> 'prepaid_id', '') is not null
     group by 1, 2
  loop
    select * into v_prepaid from public.client_prepaids where id = v_pkg.prepaid_id for update;
    if not found or v_prepaid.kind <> 'package' or v_prepaid.status <> 'active' then
      raise exception 'El paquete indicado no está disponible' using errcode = 'P0001';
    end if;
    if v_client is null or v_prepaid.client_id <> v_client then
      raise exception 'El paquete "%" pertenece a otro cliente', v_prepaid.name using errcode = 'P0001';
    end if;
    if v_prepaid.service_id is distinct from v_pkg.service_id then
      raise exception 'El paquete "%" no incluye ese servicio', v_prepaid.name using errcode = 'P0001';
    end if;
    if v_prepaid.expires_at is not null and v_prepaid.expires_at < now() then
      raise exception 'El paquete "%" venció el %', v_prepaid.name, to_char(v_prepaid.expires_at at time zone public.business_tz(), 'DD/MM/YYYY') using errcode = 'P0001';
    end if;
    if v_pkg.qty <> trunc(v_pkg.qty) or v_prepaid.sessions_total - v_prepaid.sessions_used < v_pkg.qty then
      raise exception 'Al paquete "%" le quedan % sesiones', v_prepaid.name, v_prepaid.sessions_total - v_prepaid.sessions_used using errcode = 'P0001';
    end if;
  end loop;

  -- Normaliza ítems: las sesiones de paquete se descuentan por completo
  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    if nullif(v_item ->> 'prepaid_id', '') is not null then
      if v_item ->> 'item_kind' <> 'service' then
        raise exception 'Solo los servicios pueden usar sesiones de paquete' using errcode = '22023';
      end if;
      v_item := v_item || jsonb_build_object('discount', round((v_item ->> 'quantity')::numeric * (v_item ->> 'unit_price')::numeric, 2));
    end if;
    v_items := v_items || jsonb_build_array(v_item);
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

  -- Gift card: saldo aplicado como descuento
  if v_gc_code is not null and v_gc_amount > 0 then
    select * into v_gc from public.client_prepaids where code = v_gc_code for update;
    if not found or v_gc.kind <> 'gift_card' or v_gc.status <> 'active' then
      raise exception 'Gift card no válida' using errcode = 'P0001';
    end if;
    if v_gc.expires_at is not null and v_gc.expires_at < now() then
      raise exception 'La gift card venció el %', to_char(v_gc.expires_at at time zone public.business_tz(), 'DD/MM/YYYY') using errcode = 'P0001';
    end if;
    if v_gc.balance < v_gc_amount then
      raise exception 'La gift card tiene un saldo de %', v_gc.balance using errcode = 'P0001';
    end if;
    if v_discount + v_gc_amount > v_subtotal then
      raise exception 'El monto de la gift card (%) supera lo que queda por pagar (%)', v_gc_amount, v_subtotal - v_discount using errcode = 'P0001';
    end if;
    v_discount := v_discount + v_gc_amount;
  else
    v_gc_amount := 0;
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

  if coalesce(s.loyalty_points_enabled, false) and v_client is not null then
    v_earned := floor(greatest(v_subtotal - v_discount, 0) * s.loyalty_points_per_currency)::integer;
  end if;

  insert into public.transactions (
    cash_register_id, client_id, appointment_id, created_by, tip_staff_id,
    subtotal, discount_amount, tip_amount, total, cash_received, change_given, notes,
    points_earned, points_redeemed, points_discount, credit_amount, credit_prepaid_id
  ) values (
    v_register, v_client, v_appointment, public.current_staff_id(), case when v_tip > 0 then v_tip_staff end,
    v_subtotal, v_discount, v_tip, v_total, v_cash_recv, v_change, nullif(p_payload ->> 'notes', ''),
    v_earned, v_redeem, v_points_val, v_gc_amount, case when v_gc_amount > 0 then v_gc.id end
  )
  returning id, ticket_number into v_tx, v_ticket;

  for v_item in select value from jsonb_array_elements(v_items)
  loop
    insert into public.transaction_items (
      transaction_id, item_kind, service_id, inventory_item_id, plan_id, prepaid_id, staff_id, description, quantity, unit_price, discount
    ) values (
      v_tx,
      v_item ->> 'item_kind',
      nullif(v_item ->> 'service_id', '')::uuid,
      nullif(v_item ->> 'inventory_item_id', '')::uuid,
      nullif(v_item ->> 'plan_id', '')::uuid,
      nullif(v_item ->> 'prepaid_id', '')::uuid,
      nullif(v_item ->> 'staff_id', '')::uuid,
      coalesce(nullif(v_item ->> 'description', ''), 'Ítem'),
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'unit_price')::numeric,
      coalesce((v_item ->> 'discount')::numeric, 0)
    );
  end loop;

  -- Consumo de sesiones de paquete
  for v_pkg in
    select (value ->> 'prepaid_id')::uuid as prepaid_id, sum((value ->> 'quantity')::numeric)::integer as qty
      from jsonb_array_elements(v_items)
     where nullif(value ->> 'prepaid_id', '') is not null
     group by 1
  loop
    update public.client_prepaids set sessions_used = sessions_used + v_pkg.qty where id = v_pkg.prepaid_id;
    insert into public.prepaid_usages (prepaid_id, transaction_id, sessions) values (v_pkg.prepaid_id, v_tx, v_pkg.qty);
  end loop;

  if v_gc_amount > 0 then
    update public.client_prepaids set balance = balance - v_gc_amount where id = v_gc.id;
    insert into public.prepaid_usages (prepaid_id, transaction_id, amount) values (v_gc.id, v_tx, v_gc_amount);
  end if;

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
      perform public.loyalty_apply(v_client, v_earned, 'earn', v_tx, 'Compra ticket #' || v_ticket);
    end if;
    select loyalty_points into v_balance from public.clients where id = v_client;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'code', code, 'kind', kind,
                                               'expires_at', expires_at, 'sessions', sessions_total, 'credit', initial_credit)), '[]'::jsonb)
    into v_created
    from public.client_prepaids where sale_transaction_id = v_tx;

  return jsonb_build_object(
    'id', v_tx, 'ticket_number', v_ticket, 'total', v_total, 'change', v_change, 'deposits', v_dep_total,
    'points_earned', v_earned, 'points_redeemed', v_redeem, 'points_balance', v_balance,
    'gift_card_amount', v_gc_amount, 'gift_card_balance', case when v_gc_amount > 0 then v_gc.balance - v_gc_amount end,
    'prepaids', v_created
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Anulación: revierte usos y cancela prepagos vendidos sin usar
-- ---------------------------------------------------------------------
create or replace function public.void_transaction(p_transaction_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tx public.transactions;
  u    record;
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
  if exists (
    select 1 from public.client_prepaids
     where sale_transaction_id = p_transaction_id and status = 'active'
       and (sessions_used > 0 or balance < initial_credit)
  ) then
    raise exception 'Un paquete o gift card de esta venta ya fue usado; no se puede anular' using errcode = 'P0001';
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

  -- Devuelve sesiones y saldo usados en esta venta
  for u in select * from public.prepaid_usages where transaction_id = p_transaction_id and not reversed for update
  loop
    update public.client_prepaids
       set sessions_used = greatest(0, sessions_used - u.sessions),
           balance = least(initial_credit, balance + u.amount)
     where id = u.prepaid_id;
    update public.prepaid_usages set reversed = true where id = u.id;
  end loop;

  -- Prepagos vendidos en esta venta (sin usar): se cancelan
  update public.client_prepaids set status = 'cancelled' where sale_transaction_id = p_transaction_id;

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
alter table public.prepaid_plans   enable row level security;
alter table public.client_prepaids enable row level security;
alter table public.prepaid_usages  enable row level security;

drop policy if exists prepaid_plans_select on public.prepaid_plans;
drop policy if exists prepaid_plans_write on public.prepaid_plans;
drop policy if exists client_prepaids_select on public.client_prepaids;
drop policy if exists prepaid_usages_select on public.prepaid_usages;

create policy prepaid_plans_select on public.prepaid_plans for select to authenticated using (public.is_staff());
create policy prepaid_plans_write on public.prepaid_plans for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));
create policy client_prepaids_select on public.client_prepaids for select to authenticated using (public.is_staff());
create policy prepaid_usages_select on public.prepaid_usages for select to authenticated using (public.is_staff());

grant select, insert, update, delete on public.prepaid_plans to authenticated;
grant select on public.client_prepaids, public.prepaid_usages to authenticated;
revoke insert, update, delete on public.client_prepaids, public.prepaid_usages from authenticated;

revoke execute on function public.create_sale(jsonb) from public, anon;
grant execute on function public.create_sale(jsonb) to authenticated;
revoke execute on function public.void_transaction(uuid, text) from public, anon;
grant execute on function public.void_transaction(uuid, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> 011_visit_surveys.sql <<<<<<<<<<<<<<<<<<<<

-- =====================================================================
--  011_visit_surveys.sql — Encuesta de satisfacción después de la visita
--
--  · Recepción genera un enlace único por ticket (token aleatorio de 128 bits).
--  · El cliente responde sin cuenta en /encuesta/<token>: una sola vez y dentro
--    de 30 días. El público solo accede vía dos funciones validadas.
--  · Reporte: promedio por profesional y comentarios recientes.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.visit_surveys (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique check (token ~ '^[0-9a-f]{32}$'),
  transaction_id  uuid not null unique constraint visit_surveys_transaction_fk references public.transactions (id) on delete cascade,
  client_id       uuid constraint visit_surveys_client_fk references public.clients (id) on delete set null,
  staff_id        uuid constraint visit_surveys_staff_fk references public.staff_members (id) on delete set null,
  rating          smallint check (rating between 1 and 5),
  comment         text check (comment is null or char_length(comment) <= 500),
  created_by      uuid constraint visit_surveys_created_by_fk references public.staff_members (id) on delete set null,
  created_at      timestamptz not null default now(),
  answered_at     timestamptz,
  constraint visit_surveys_answer check ((rating is null) = (answered_at is null))
);
create index if not exists visit_surveys_staff_idx on public.visit_surveys (staff_id, answered_at desc);
create index if not exists visit_surveys_answered_idx on public.visit_surveys (answered_at desc) where answered_at is not null;

-- Genera (o reutiliza) la encuesta de un ticket
create or replace function public.create_visit_survey(p_transaction_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_tx    public.transactions;
  v_token text;
  v_staff uuid;
begin
  if not public.has_role('owner', 'admin', 'receptionist') then
    raise exception 'No tienes permiso para enviar encuestas' using errcode = '42501';
  end if;
  select * into v_tx from public.transactions where id = p_transaction_id;
  if not found or v_tx.status <> 'completed' then
    raise exception 'La venta no existe o fue anulada' using errcode = 'P0002';
  end if;

  select token into v_token from public.visit_surveys where transaction_id = p_transaction_id;
  if v_token is not null then
    return v_token;
  end if;

  -- Profesional principal: el del servicio de mayor importe
  select staff_id into v_staff from public.transaction_items
   where transaction_id = p_transaction_id and item_kind = 'service' and staff_id is not null
   order by quantity * unit_price desc
   limit 1;

  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  insert into public.visit_surveys (token, transaction_id, client_id, staff_id, created_by)
  values (v_token, p_transaction_id, v_tx.client_id, v_staff, public.current_staff_id());
  return v_token;
end;
$$;

-- Lectura pública mínima (sin datos personales salvo el nombre de pila)
create or replace function public.public_get_survey(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v public.visit_surveys;
  s public.business_settings;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    return jsonb_build_object('found', false);
  end if;
  select * into v from public.visit_surveys where token = p_token;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select * into s from public.business_settings limit 1;
  return jsonb_build_object(
    'found', true,
    'business_name', s.business_name,
    'logo_url', s.logo_url,
    'client_name', (select split_part(trim(full_name), ' ', 1) from public.clients where id = v.client_id),
    'staff_name', (select public.public_staff_name(full_name) from public.staff_members where id = v.staff_id),
    'services', coalesce((select jsonb_agg(distinct description) from public.transaction_items
                           where transaction_id = v.transaction_id and item_kind = 'service'), '[]'::jsonb),
    'answered', v.answered_at is not null,
    'expired', v.created_at < now() - interval '30 days'
  );
end;
$$;

create or replace function public.public_submit_survey(p_token text, p_rating integer, p_comment text default null)
returns boolean
language plpgsql volatile security definer set search_path = public
as $$
declare
  v public.visit_surveys;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
    raise exception 'Encuesta no encontrada' using errcode = 'P0002';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Elige una calificación de 1 a 5' using errcode = '22023';
  end if;
  if p_comment is not null and char_length(p_comment) > 500 then
    raise exception 'El comentario no puede superar 500 caracteres' using errcode = '22023';
  end if;
  select * into v from public.visit_surveys where token = p_token for update;
  if not found then
    raise exception 'Encuesta no encontrada' using errcode = 'P0002';
  end if;
  if v.answered_at is not null then
    raise exception 'Esta encuesta ya fue respondida. ¡Gracias!' using errcode = 'P0001';
  end if;
  if v.created_at < now() - interval '30 days' then
    raise exception 'El enlace de la encuesta venció' using errcode = 'P0001';
  end if;
  update public.visit_surveys
     set rating = p_rating, comment = nullif(trim(coalesce(p_comment, '')), ''), answered_at = now()
   where id = v.id;
  return true;
end;
$$;

-- Promedio por profesional (respeta RLS)
create or replace function public.report_survey_summary(p_from date, p_to date)
returns table (staff_id uuid, full_name text, responses bigint, average numeric, promoters bigint, detractors bigint)
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
  select v.staff_id, coalesce(m.full_name, 'Sin asignar'), count(*)::bigint, round(avg(v.rating), 2)::numeric,
         count(*) filter (where v.rating = 5)::bigint, count(*) filter (where v.rating <= 3)::bigint
    from public.visit_surveys v
    left join public.staff_members m on m.id = v.staff_id
   where v.answered_at >= v_start and v.answered_at < v_end
   group by v.staff_id, m.full_name
   order by 4 desc, 3 desc;
end;
$$;

alter table public.visit_surveys enable row level security;
drop policy if exists visit_surveys_select on public.visit_surveys;
create policy visit_surveys_select on public.visit_surveys for select to authenticated
  using (public.has_role('owner', 'admin', 'receptionist') or staff_id = public.current_staff_id());
grant select on public.visit_surveys to authenticated;
revoke insert, update, delete on public.visit_surveys from authenticated;

revoke execute on function public.create_visit_survey(uuid) from public, anon;
grant execute on function public.create_visit_survey(uuid) to authenticated;
revoke execute on function public.public_get_survey(text) from public;
revoke execute on function public.public_submit_survey(text, integer, text) from public;
grant execute on function public.public_get_survey(text) to anon, authenticated;
grant execute on function public.public_submit_survey(text, integer, text) to anon, authenticated;
revoke execute on function public.report_survey_summary(date, date) from public, anon;
grant execute on function public.report_survey_summary(date, date) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> 012_client_photos.sql <<<<<<<<<<<<<<<<<<<<

-- =====================================================================
--  012_client_photos.sql — Fotos de antes y después por cliente
--
--  · Los archivos viven en el bucket PRIVADO "client-photos" (creado en 001);
--    se ven solo con URLs firmadas temporales.
--  · Ruta: <client_id>/<uuid>.<ext>. Límite 5 MB, solo JPG/PNG/WEBP.
--  · Borra la foto quien la subió o administración.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.client_photos (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null constraint client_photos_client_fk references public.clients (id) on delete cascade,
  path        text not null unique check (char_length(path) between 10 and 300),
  kind        text not null default 'after' check (kind in ('before', 'after', 'other')),
  caption     text check (caption is null or char_length(caption) <= 200),
  taken_on    date not null default current_date,
  created_by  uuid constraint client_photos_created_by_fk references public.staff_members (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- La ruta debe empezar con la carpeta del propio cliente
  constraint client_photos_path_owner check (path like client_id::text || '/%')
);
create index if not exists client_photos_client_idx on public.client_photos (client_id, taken_on desc, created_at desc);

create or replace function public.client_photos_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.created_by := public.current_staff_id();
  new.created_at := now();
  new.caption := nullif(trim(coalesce(new.caption, '')), '');
  return new;
end;
$$;

drop trigger if exists trg_client_photos_before_insert on public.client_photos;
create trigger trg_client_photos_before_insert before insert on public.client_photos
  for each row execute function public.client_photos_before_insert();

alter table public.client_photos enable row level security;
drop policy if exists client_photos_select on public.client_photos;
drop policy if exists client_photos_insert on public.client_photos;
drop policy if exists client_photos_delete on public.client_photos;
create policy client_photos_select on public.client_photos for select to authenticated using (public.is_staff());
create policy client_photos_insert on public.client_photos for insert to authenticated with check (public.is_staff());
create policy client_photos_delete on public.client_photos for delete to authenticated
  using (public.has_role('owner', 'admin') or created_by = public.current_staff_id());
grant select, insert, delete on public.client_photos to authenticated;

-- Storage: límites del bucket y política de borrado
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set public = false,
           file_size_limit = 5242880,
           allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
     where id = 'client-photos';

    execute 'drop policy if exists "client_photos_staff_delete" on storage.objects';
    execute $p$create policy "client_photos_staff_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'client-photos' and (public.has_role('owner', 'admin') or owner = auth.uid()))$p$;
  end if;
end;
$$;


-- >>>>>>>>>>>>>>>>>>>> 013_suppliers_purchases.sql <<<<<<<<<<<<<<<<<<<<

-- =====================================================================
--  013_suppliers_purchases.sql — Proveedores y órdenes de compra
--
--  · Orden: borrador → enviada → recibida (o anulada).
--  · Recibir (RPC receive_purchase_order) en una sola transacción:
--      suma stock (movimientos "purchase" con referencia "OC #n"),
--      actualiza el costo del producto y, opcionalmente, registra el pago
--      como gasto de la caja abierta.
--  · Una orden recibida o anulada ya no se puede modificar.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(trim(name)) between 2 and 120),
  contact_name  text check (contact_name is null or char_length(contact_name) <= 120),
  phone         text check (phone is null or char_length(phone) <= 40),
  email         text check (email is null or char_length(email) <= 120),
  tax_id        text check (tax_id is null or char_length(tax_id) <= 30),
  notes         text check (notes is null or char_length(notes) <= 500),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists suppliers_name_key on public.suppliers (lower(trim(name)));

drop trigger if exists trg_suppliers_updated_at on public.suppliers;
create trigger trg_suppliers_updated_at before update on public.suppliers for each row execute function public.set_updated_at();

create table if not exists public.purchase_orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      bigint generated by default as identity unique,
  supplier_id       uuid not null constraint purchase_orders_supplier_fk references public.suppliers (id) on delete restrict,
  status            text not null default 'draft' check (status in ('draft', 'ordered', 'received', 'cancelled')),
  expected_on       date,
  notes             text check (notes is null or char_length(notes) <= 500),
  created_by        uuid constraint purchase_orders_created_by_fk references public.staff_members (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  received_at       timestamptz,
  received_by       uuid constraint purchase_orders_received_by_fk references public.staff_members (id) on delete set null,
  cash_movement_id  uuid constraint purchase_orders_cash_movement_fk references public.cash_movements (id) on delete set null,
  constraint purchase_orders_received check ((status = 'received') = (received_at is not null))
);
create index if not exists purchase_orders_status_idx on public.purchase_orders (status, created_at desc);

create table if not exists public.purchase_order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null constraint purchase_order_items_order_fk references public.purchase_orders (id) on delete cascade,
  item_id     uuid not null constraint purchase_order_items_item_fk references public.inventory_items (id) on delete restrict,
  quantity    numeric(12,2) not null check (quantity > 0 and quantity <= 100000),
  unit_cost   numeric(10,2) not null check (unit_cost >= 0),
  line_total  numeric(12,2) generated always as (round(quantity * unit_cost, 2)) stored,
  unique (order_id, item_id)
);
create index if not exists purchase_order_items_order_idx on public.purchase_order_items (order_id);

-- Órdenes cerradas son inmutables; "received" solo vía RPC
create or replace function public.purchase_orders_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := public.current_staff_id();
    if new.status not in ('draft', 'ordered') then
      raise exception 'Una orden nueva debe ser borrador o enviada' using errcode = '22023';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Solo se pueden eliminar órdenes en borrador; anúlala en su lugar' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status in ('received', 'cancelled') then
    raise exception 'La orden #% ya está cerrada', old.order_number using errcode = 'P0001';
  end if;
  if new.status = 'received' and coalesce(current_setting('app.po_receive', true), '') <> 'on' then
    raise exception 'Usa «Recibir mercadería» para cerrar la orden' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_purchase_orders_guard on public.purchase_orders;
create trigger trg_purchase_orders_guard before insert or update or delete on public.purchase_orders
  for each row execute function public.purchase_orders_guard();

create or replace function public.purchase_order_items_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.purchase_orders where id = coalesce(new.order_id, old.order_id);
  if v_status is not null and v_status not in ('draft', 'ordered') then
    raise exception 'La orden ya está cerrada; no se pueden cambiar sus productos' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_purchase_order_items_guard on public.purchase_order_items;
create trigger trg_purchase_order_items_guard before insert or update or delete on public.purchase_order_items
  for each row execute function public.purchase_order_items_guard();

-- ---------------------------------------------------------------------
-- Recibir mercadería
-- ---------------------------------------------------------------------
create or replace function public.receive_purchase_order(p_order_id uuid, p_pay_from_register boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order    public.purchase_orders;
  v_supplier text;
  v_total    numeric;
  v_lines    integer;
  v_register uuid;
  v_movement uuid;
begin
  if not public.has_role('owner', 'admin') then
    raise exception 'Solo administración puede recibir mercadería' using errcode = '42501';
  end if;

  select * into v_order from public.purchase_orders where id = p_order_id for update;
  if not found then
    raise exception 'Orden no encontrada' using errcode = 'P0002';
  end if;
  if v_order.status not in ('draft', 'ordered') then
    raise exception 'La orden #% ya está cerrada', v_order.order_number using errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(line_total), 0) into v_lines, v_total from public.purchase_order_items where order_id = p_order_id;
  if v_lines = 0 then
    raise exception 'La orden no tiene productos' using errcode = 'P0001';
  end if;
  select name into v_supplier from public.suppliers where id = v_order.supplier_id;

  insert into public.inventory_movements (item_id, movement_type, quantity, unit_cost, reference, notes, created_by)
  select i.item_id, 'purchase', i.quantity, i.unit_cost, 'OC #' || v_order.order_number, v_supplier, public.current_staff_id()
    from public.purchase_order_items i
   where i.order_id = p_order_id;

  -- Último costo de compra
  update public.inventory_items it
     set cost = i.unit_cost
    from public.purchase_order_items i
   where i.order_id = p_order_id and it.id = i.item_id and i.unit_cost > 0;

  if p_pay_from_register and v_total > 0 then
    select id into v_register from public.cash_registers where status = 'open' limit 1;
    if v_register is null then
      raise exception 'Abre la caja para pagar la compra en efectivo' using errcode = 'P0001';
    end if;
    insert into public.cash_movements (cash_register_id, movement_type, category, amount, description)
    values (v_register, 'expense', 'supplies', v_total, left('Compra OC #' || v_order.order_number || ' · ' || coalesce(v_supplier, ''), 200))
    returning id into v_movement;
  end if;

  perform set_config('app.po_receive', 'on', true);
  update public.purchase_orders
     set status = 'received', received_at = now(), received_by = public.current_staff_id(), cash_movement_id = v_movement
   where id = p_order_id;
  perform set_config('app.po_receive', 'off', true);

  return jsonb_build_object('order_number', v_order.order_number, 'total', v_total, 'lines', v_lines, 'paid_from_register', v_movement is not null);
end;
$$;

-- ---------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

drop policy if exists suppliers_select on public.suppliers;
drop policy if exists suppliers_write on public.suppliers;
drop policy if exists purchase_orders_select on public.purchase_orders;
drop policy if exists purchase_orders_write on public.purchase_orders;
drop policy if exists purchase_order_items_select on public.purchase_order_items;
drop policy if exists purchase_order_items_write on public.purchase_order_items;

create policy suppliers_select on public.suppliers for select to authenticated using (public.is_staff());
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (public.has_role('owner', 'admin', 'receptionist'));
create policy purchase_orders_write on public.purchase_orders for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));
create policy purchase_order_items_select on public.purchase_order_items for select to authenticated
  using (public.has_role('owner', 'admin', 'receptionist'));
create policy purchase_order_items_write on public.purchase_order_items for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));

grant select, insert, update, delete on public.suppliers, public.purchase_orders, public.purchase_order_items to authenticated;

revoke execute on function public.receive_purchase_order(uuid, boolean) from public, anon;
grant execute on function public.receive_purchase_order(uuid, boolean) to authenticated;


-- >>>>>>>>>>>>>>>>>>>> 014_audit_log.sql <<<<<<<<<<<<<<<<<<<<

-- =====================================================================
--  014_audit_log.sql — Registro de auditoría (solo agregar)
--
--  · Un trigger genérico registra quién cambió qué, con valor anterior y nuevo.
--  · Solo se registran las columnas relevantes de cada tabla (menos ruido).
--  · Nadie puede editar ni borrar el registro desde la app (sin permisos de
--    escritura); solo propietario/administración pueden consultarlo.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.audit_log (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  actor_staff_id  uuid constraint audit_log_actor_fk references public.staff_members (id) on delete set null,
  actor_name      text,
  table_name      text not null,
  record_id       text,
  action          text not null check (action in ('insert', 'update', 'delete')),
  changes         jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index if not exists audit_log_table_idx on public.audit_log (table_name, occurred_at desc);
create index if not exists audit_log_record_idx on public.audit_log (record_id);

-- tg_argv: columnas a vigilar en UPDATE (vacío = todas salvo updated_at)
create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new     jsonb := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) else null end;
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
  v_watch   text[] := tg_argv;
  v_actor   uuid := public.current_staff_id();
begin
  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new)
    loop
      continue when v_key in ('updated_at', 'created_at');
      continue when array_length(v_watch, 1) > 0 and not (v_key = any (v_watch));
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_array(v_old -> v_key, v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    v_changes := v_new - 'created_at' - 'updated_at';
  else
    v_changes := v_old - 'created_at' - 'updated_at';
  end if;

  insert into public.audit_log (actor_staff_id, actor_name, table_name, record_id, action, changes)
  values (
    v_actor,
    (select full_name from public.staff_members where id = v_actor),
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    lower(tg_op),
    v_changes
  );
  return coalesce(new, old);
end;
$$;

-- Tablas auditadas
do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      ('business_settings',     'update',                  array[]::text[]),
      ('staff_members',         'insert or update or delete', array['full_name','email','role','is_active','is_bookable','commission_type','commission_value','product_commission_rate']),
      ('services',              'insert or update or delete', array['name','price','duration_minutes','processing_minutes','commission_type','commission_value','is_active','online_bookable']),
      ('transactions',          'update',                  array['status','void_reason','voided_by']),
      ('cash_registers',        'insert or update',        array['status','opening_amount','counted_cash','expected_cash','difference']),
      ('cash_movements',        'insert or delete',        array[]::text[]),
      ('appointments',          'update or delete',        array['status','starts_at','staff_id','price','cancellation_reason']),
      ('clients',               'update or delete',        array['full_name','phone','is_active']),
      ('inventory_items',       'insert or update or delete', array['name','price','cost','min_stock','is_active']),
      ('commission_payouts',    'insert',                  array[]::text[]),
      ('appointment_deposits',  'insert or update',        array['status','amount']),
      ('prepaid_plans',         'insert or update or delete', array['name','price','sessions','credit','validity_days','is_active']),
      ('purchase_orders',       'insert or update or delete', array['status','supplier_id'])
    ) as t(tbl, events, cols)
  loop
    if to_regclass('public.' || spec.tbl) is null then
      continue;
    end if;
    execute format('drop trigger if exists trg_audit_%1$s on public.%1$I', spec.tbl);
    execute format(
      'create trigger trg_audit_%1$s after %2$s on public.%1$I for each row execute function public.audit_row(%3$s)',
      spec.tbl, spec.events,
      coalesce((select string_agg(quote_literal(c), ', ') from unnest(spec.cols) c), '')
    );
  end loop;
end;
$$;

alter table public.audit_log enable row level security;
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated using (public.has_role('owner', 'admin'));
grant select on public.audit_log to authenticated;
revoke insert, update, delete, truncate on public.audit_log from authenticated, anon;
revoke execute on function public.audit_row() from public, anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>> 015_branches.sql <<<<<<<<<<<<<<<<<<<<

-- =====================================================================
--  015_branches.sql — Multisede
--
--  · Crea "Sede principal" y asigna todo lo existente a ella: con una sola sede
--    el sistema funciona exactamente igual que antes.
--  · Por sede: equipo, agenda, caja abierta (una por sede), ventas y reportes.
--  · Inventario: compartido entre sedes (almacén central).
--  · Las funciones que buscan "la caja abierta" usan la sede indicada; si no se
--    indica y hay varias cajas abiertas, usan la sede del usuario.
--  Re-ejecutable.
-- =====================================================================

create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 2 and 80),
  address     text check (address is null or char_length(address) <= 200),
  phone       text check (phone is null or char_length(phone) <= 40),
  is_main     boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists branches_name_key on public.branches (lower(trim(name)));
create unique index if not exists branches_single_main on public.branches ((true)) where is_main;

drop trigger if exists trg_branches_updated_at on public.branches;
create trigger trg_branches_updated_at before update on public.branches for each row execute function public.set_updated_at();

insert into public.branches (name, address, phone, is_main)
select 'Sede principal', s.address, s.phone, true
  from (select address, phone from public.business_settings limit 1) s
 where not exists (select 1 from public.branches where is_main);
insert into public.branches (name, is_main)
select 'Sede principal', true where not exists (select 1 from public.branches where is_main);

create or replace function public.main_branch_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.branches where is_main limit 1;
$$;

-- La sede principal no se puede desactivar ni dejar de ser principal sin otra
create or replace function public.branches_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las sedes no se eliminan; desactívala en su lugar' using errcode = 'P0001';
  end if;
  if old.is_main and (not new.is_main or not new.is_active) then
    raise exception 'La sede principal debe seguir activa' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_branches_guard on public.branches;
create trigger trg_branches_guard before update or delete on public.branches for each row execute function public.branches_guard();

-- ---------------------------------------------------------------------
-- Columnas de sede (con relleno de lo existente)
-- ---------------------------------------------------------------------
alter table public.staff_members  add column if not exists branch_id uuid constraint staff_members_branch_fk references public.branches (id) on delete restrict;
alter table public.appointments   add column if not exists branch_id uuid constraint appointments_branch_fk references public.branches (id) on delete restrict;
alter table public.cash_registers add column if not exists branch_id uuid constraint cash_registers_branch_fk references public.branches (id) on delete restrict;
alter table public.transactions   add column if not exists branch_id uuid constraint transactions_branch_fk references public.branches (id) on delete restrict;

update public.staff_members  set branch_id = public.main_branch_id() where branch_id is null;
update public.cash_registers set branch_id = public.main_branch_id() where branch_id is null;
update public.appointments a set branch_id = coalesce((select s.branch_id from public.staff_members s where s.id = a.staff_id), public.main_branch_id()) where a.branch_id is null;
update public.transactions t set branch_id = coalesce((select r.branch_id from public.cash_registers r where r.id = t.cash_register_id), public.main_branch_id()) where t.branch_id is null;

alter table public.staff_members  alter column branch_id set not null;
alter table public.appointments   alter column branch_id set not null;
alter table public.cash_registers alter column branch_id set not null;
alter table public.transactions   alter column branch_id set not null;

create index if not exists appointments_branch_starts_idx on public.appointments (branch_id, starts_at);
create index if not exists transactions_branch_created_idx on public.transactions (branch_id, created_at desc);

-- Una caja abierta POR SEDE
drop index if exists public.cash_registers_single_open;
create unique index if not exists cash_registers_open_per_branch on public.cash_registers (branch_id) where status = 'open';

-- Valores por defecto
create or replace function public.branch_defaults()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'staff_members' then
    new.branch_id := coalesce(new.branch_id, public.main_branch_id());
  elsif tg_table_name = 'appointments' then
    if tg_op = 'INSERT' or new.staff_id is distinct from old.staff_id then
      new.branch_id := coalesce(
        case when tg_op = 'INSERT' then new.branch_id end,
        (select branch_id from public.staff_members where id = new.staff_id),
        public.main_branch_id());
    end if;
  elsif tg_table_name = 'cash_registers' then
    new.branch_id := coalesce(new.branch_id, (select branch_id from public.staff_members where id = public.current_staff_id()), public.main_branch_id());
  elsif tg_table_name = 'transactions' then
    new.branch_id := coalesce((select branch_id from public.cash_registers where id = new.cash_register_id), public.main_branch_id());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_staff_branch_default on public.staff_members;
create trigger trg_staff_branch_default before insert or update on public.staff_members for each row execute function public.branch_defaults();
drop trigger if exists trg_appointments_branch_default on public.appointments;
create trigger trg_appointments_branch_default before insert or update on public.appointments for each row execute function public.branch_defaults();
drop trigger if exists trg_registers_branch_default on public.cash_registers;
create trigger trg_registers_branch_default before insert on public.cash_registers for each row execute function public.branch_defaults();
drop trigger if exists trg_transactions_branch_default on public.transactions;
create trigger trg_transactions_branch_default before insert on public.transactions for each row execute function public.branch_defaults();

-- ---------------------------------------------------------------------
-- Caja abierta de una sede
-- ---------------------------------------------------------------------
create or replace function public.open_register_for(p_branch uuid)
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_branch is not null then
    select id into v_id from public.cash_registers where status = 'open' and branch_id = p_branch limit 1;
    return v_id;
  end if;
  if (select count(*) from public.cash_registers where status = 'open') > 1 then
    select r.id into v_id from public.cash_registers r
     where r.status = 'open' and r.branch_id = (select branch_id from public.staff_members where id = public.current_staff_id())
     limit 1;
    return v_id;
  end if;
  select id into v_id from public.cash_registers where status = 'open' limit 1;
  return v_id;
end;
$$;

-- Ajusta las funciones existentes para usar la caja de la sede (reemplazo verificado del texto)
do $$
declare
  v_def text;
  r record;
begin
  for r in
    select * from (values
      ('public.create_sale(jsonb)'::regprocedure,
       'select id into v_register from public.cash_registers where status = ''open'' limit 1;',
       'v_register := public.open_register_for(nullif(p_payload ->> ''branch_id'', '''')::uuid);'),
      ('public.record_deposit(uuid, numeric, text, text)'::regprocedure,
       'select id into v_register from public.cash_registers where status = ''open'' limit 1 for update;',
       'v_register := public.open_register_for(v_appt.branch_id);'),
      ('public.resolve_deposit(uuid, text, text)'::regprocedure,
       'select id into v_register from public.cash_registers where status = ''open'' limit 1 for update;',
       'v_register := public.open_register_for((select a.branch_id from public.appointments a where a.id = v_dep.appointment_id));'),
      ('public.receive_purchase_order(uuid, boolean)'::regprocedure,
       'select id into v_register from public.cash_registers where status = ''open'' limit 1;',
       'v_register := public.open_register_for(null);')
    ) as t(fn, old_text, new_text)
  loop
    v_def := pg_get_functiondef(r.fn);
    if position(r.old_text in v_def) > 0 then
      execute replace(v_def, r.old_text, r.new_text);
    elsif position(r.new_text in v_def) = 0 then
      raise exception 'No se pudo adaptar % a multisede', r.fn;
    end if;
  end loop;
end;
$$;

-- Cierre de caja de una sede (reemplaza la versión sin sede)
drop function if exists public.close_cash_register(numeric, text);
create or replace function public.close_cash_register(p_counted_cash numeric, p_notes text default null, p_branch_id uuid default null)
returns public.cash_registers
language plpgsql security invoker set search_path = public
as $$
declare
  v_reg      public.cash_registers;
  v_id       uuid;
  v_expected numeric;
begin
  if not public.has_role('owner', 'admin', 'receptionist') then
    raise exception 'No tienes permiso para cerrar caja' using errcode = '42501';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'Ingresa el efectivo contado' using errcode = '22023';
  end if;

  v_id := public.open_register_for(p_branch_id);
  select * into v_reg from public.cash_registers where id = v_id for update;
  if not found then
    raise exception 'No hay una caja abierta' using errcode = 'P0002';
  end if;

  v_expected := (public.register_summary(v_reg.id) ->> 'expected_cash')::numeric;

  update public.cash_registers
     set status        = 'closed',
         closed_at     = now(),
         closed_by     = public.current_staff_id(),
         expected_cash = v_expected,
         counted_cash  = p_counted_cash,
         difference    = p_counted_cash - v_expected,
         notes         = coalesce(nullif(p_notes, ''), notes)
   where id = v_reg.id
  returning * into v_reg;

  return v_reg;
end;
$$;

-- ---------------------------------------------------------------------
-- Dashboard y reportes con filtro opcional de sede
-- ---------------------------------------------------------------------
drop function if exists public.dashboard_today(date);
create or replace function public.dashboard_today(p_date date default null, p_branch_id uuid default null)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_tz    text := public.business_tz();
  v_day   date := coalesce(p_date, (now() at time zone v_tz)::date);
  v_start timestamptz := (v_day::timestamp at time zone v_tz);
  v_end   timestamptz := ((v_day + 1)::timestamp at time zone v_tz);
  v_out   jsonb;
begin
  select jsonb_build_object(
    'date', v_day,
    'revenue', coalesce((
      select sum(t.subtotal - t.discount_amount) from public.transactions t
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
         and (p_branch_id is null or t.branch_id = p_branch_id)), 0),
    'tips', coalesce((
      select sum(t.tip_amount) from public.transactions t
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
         and (p_branch_id is null or t.branch_id = p_branch_id)), 0),
    'transactions', (
      select count(*) from public.transactions t
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
         and (p_branch_id is null or t.branch_id = p_branch_id)),
    'commissions', coalesce((
      select sum(ti.commission_amount)
        from public.transaction_items ti
        join public.transactions t on t.id = ti.transaction_id
       where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
         and (p_branch_id is null or t.branch_id = p_branch_id)), 0),
    'appointments', coalesce((
      select jsonb_object_agg(a.status, a.n)
        from (select status, count(*) as n from public.appointments
               where starts_at >= v_start and starts_at < v_end
                 and (p_branch_id is null or branch_id = p_branch_id)
               group by status) a), '{}'::jsonb),
    'low_stock_count', (select count(*) from public.inventory_items where is_active and is_low_stock),
    'low_stock', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'name', i.name, 'stock', i.stock, 'min_stock', i.min_stock,
               'unit', i.unit, 'item_type', i.item_type))
        from (select id, name, stock, min_stock, unit, item_type
                from public.inventory_items
               where is_active and is_low_stock
               order by (stock - min_stock), name
               limit 8) i), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

drop function if exists public.report_revenue_by_day(date, date);
create or replace function public.report_revenue_by_day(p_from date, p_to date, p_branch_id uuid default null)
returns table (day date, revenue numeric, tips numeric, tx_count bigint)
language plpgsql stable security invoker set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz text := public.business_tz();
begin
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Rango de fechas inválido (máximo 366 días)' using errcode = '22023';
  end if;
  return query
  select (p_from + g.i)::date,
         coalesce(sum(t.subtotal - t.discount_amount), 0)::numeric,
         coalesce(sum(t.tip_amount), 0)::numeric,
         count(t.id)::bigint
    from generate_series(0, p_to - p_from) as g(i)
    left join public.transactions t
      on t.status = 'completed'
     and (p_branch_id is null or t.branch_id = p_branch_id)
     and t.created_at >= ((p_from + g.i)::timestamp at time zone v_tz)
     and t.created_at <  ((p_from + g.i + 1)::timestamp at time zone v_tz)
   group by g.i
   order by g.i;
end;
$$;

drop function if exists public.report_staff_performance(date, date);
create or replace function public.report_staff_performance(p_from date, p_to date, p_branch_id uuid default null)
returns table (
  staff_id uuid, full_name text, services_count bigint, services_revenue numeric,
  products_revenue numeric, commission numeric, tips numeric
)
language plpgsql stable security invoker set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz    text := public.business_tz();
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end   timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
begin
  return query
  with items as (
    select ti.staff_id, ti.item_kind, ti.quantity, ti.line_total, ti.commission_amount
      from public.transaction_items ti
      join public.transactions t on t.id = ti.transaction_id
     where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
       and (p_branch_id is null or t.branch_id = p_branch_id)
  ),
  tip_rows as (
    select t.tip_staff_id, sum(t.tip_amount) as amount
      from public.transactions t
     where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end and t.tip_staff_id is not null
       and (p_branch_id is null or t.branch_id = p_branch_id)
     group by t.tip_staff_id
  )
  select s.id,
         s.full_name,
         coalesce(sum(i.quantity) filter (where i.item_kind = 'service'), 0)::bigint,
         coalesce(sum(i.line_total) filter (where i.item_kind = 'service'), 0)::numeric,
         coalesce(sum(i.line_total) filter (where i.item_kind = 'product'), 0)::numeric,
         coalesce(sum(i.commission_amount), 0)::numeric,
         coalesce(max(tr.amount), 0)::numeric
    from public.staff_members s
    left join items i on i.staff_id = s.id
    left join tip_rows tr on tr.tip_staff_id = s.id
   where (s.is_bookable and (p_branch_id is null or s.branch_id = p_branch_id)) or i.staff_id is not null
   group by s.id, s.full_name
   order by 4 desc, s.full_name;
end;
$$;

drop function if exists public.report_top_services(date, date, integer);
create or replace function public.report_top_services(p_from date, p_to date, p_limit integer default 10, p_branch_id uuid default null)
returns table (service_id uuid, service_name text, quantity numeric, revenue numeric)
language plpgsql stable security invoker set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz    text := public.business_tz();
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end   timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
begin
  return query
  select ti.service_id,
         coalesce(sv.name, max(ti.description)),
         sum(ti.quantity)::numeric,
         sum(ti.line_total)::numeric
    from public.transaction_items ti
    join public.transactions t on t.id = ti.transaction_id
    left join public.services sv on sv.id = ti.service_id
   where ti.item_kind = 'service' and t.status = 'completed'
     and t.created_at >= v_start and t.created_at < v_end
     and (p_branch_id is null or t.branch_id = p_branch_id)
   group by ti.service_id, sv.name
   order by 3 desc, 4 desc
   limit greatest(1, least(p_limit, 50));
end;
$$;

drop function if exists public.report_payment_methods(date, date);
create or replace function public.report_payment_methods(p_from date, p_to date, p_branch_id uuid default null)
returns table (method text, amount numeric, payments bigint)
language plpgsql stable security invoker set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz    text := public.business_tz();
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end   timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
begin
  return query
  select p.method, sum(p.amount)::numeric, count(*)::bigint
    from public.transaction_payments p
    join public.transactions t on t.id = p.transaction_id
   where t.status = 'completed' and t.created_at >= v_start and t.created_at < v_end
     and (p_branch_id is null or t.branch_id = p_branch_id)
   group by p.method
   order by 2 desc;
end;
$$;

drop function if exists public.report_cash_movements(date, date);
create or replace function public.report_cash_movements(p_from date, p_to date, p_branch_id uuid default null)
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
    join public.cash_registers r on r.id = m.cash_register_id
   where m.created_at >= v_start and m.created_at < v_end
     and (p_branch_id is null or r.branch_id = p_branch_id)
   group by m.movement_type, m.category
   order by 3 desc;
end;
$$;

-- ---------------------------------------------------------------------
-- Reserva online por sede
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  -- Info pública: agrega sedes y la sede de cada profesional
  v_def := pg_get_functiondef('public.public_booking_info()'::regprocedure);
  if position('''branch_id'', m.branch_id' in v_def) = 0 then
    v_def := replace(v_def,
      '''id'', m.id, ''name'', public.public_staff_name(m.full_name), ''specialty'', m.specialty, ''color'', m.color)',
      '''id'', m.id, ''name'', public.public_staff_name(m.full_name), ''specialty'', m.specialty, ''color'', m.color, ''branch_id'', m.branch_id)');
    v_def := replace(v_def,
      '''today'', (now() at time zone s.timezone)::date,',
      '''today'', (now() at time zone s.timezone)::date,
    ''branches'', coalesce((select jsonb_agg(jsonb_build_object(''id'', b.id, ''name'', b.name, ''address'', b.address) order by b.is_main desc, b.name)
                             from public.branches b where b.is_active), ''[]''::jsonb),');
    if position('''branch_id'', m.branch_id' in v_def) = 0 or position('''branches''' in v_def) = 0 then
      raise exception 'No se pudo adaptar public_booking_info a multisede';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Horarios: filtro opcional por sede (nueva firma; reemplaza la anterior)
do $$
declare
  v_def text;
begin
  if to_regprocedure('public.public_available_slots(uuid, date, uuid)') is not null then
    v_def := pg_get_functiondef('public.public_available_slots(uuid, date, uuid)'::regprocedure);
    v_def := replace(v_def, 'p_staff_id uuid DEFAULT NULL::uuid)', 'p_staff_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid)');
    v_def := replace(v_def,
      'and (p_staff_id is null or m.id = p_staff_id)',
      'and (p_staff_id is null or m.id = p_staff_id)
       and (p_branch_id is null or m.branch_id = p_branch_id)');
    if position('p_branch_id uuid DEFAULT NULL::uuid)' in v_def) = 0 or position('m.branch_id = p_branch_id' in v_def) = 0 then
      raise exception 'No se pudo adaptar public_available_slots a multisede';
    end if;
    drop function public.public_available_slots(uuid, date, uuid);
    execute v_def;
  end if;

  -- Crear reserva: respeta la sede elegida (en el mismo bloque, después de la nueva firma de horarios)
  v_def := pg_get_functiondef('public.public_create_booking(jsonb)'::regprocedure);
  if position('p_payload ->> ''branch_id''' in v_def) = 0 then
    v_def := replace(v_def,
      'public.public_available_slots(v_service.id, v_date, v_staff_req)',
      'public.public_available_slots(v_service.id, v_date, v_staff_req, nullif(p_payload ->> ''branch_id'', '''')::uuid)');
    if position('p_payload ->> ''branch_id''' in v_def) = 0 then
      raise exception 'No se pudo adaptar public_create_booking a multisede';
    end if;
    execute v_def;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS y permisos
-- ---------------------------------------------------------------------
alter table public.branches enable row level security;
drop policy if exists branches_select on public.branches;
drop policy if exists branches_write on public.branches;
create policy branches_select on public.branches for select to authenticated using (public.is_staff());
create policy branches_write on public.branches for all to authenticated
  using (public.has_role('owner', 'admin')) with check (public.has_role('owner', 'admin'));
grant select, insert, update on public.branches to authenticated;

revoke execute on function public.open_register_for(uuid) from public, anon;
grant execute on function public.open_register_for(uuid) to authenticated;
revoke execute on function public.main_branch_id() from public, anon;
grant execute on function public.main_branch_id() to authenticated;
revoke execute on function public.close_cash_register(numeric, text, uuid) from public, anon;
grant execute on function public.close_cash_register(numeric, text, uuid) to authenticated;
revoke execute on function public.dashboard_today(date, uuid) from public, anon;
grant execute on function public.dashboard_today(date, uuid) to authenticated;
revoke execute on function public.report_revenue_by_day(date, date, uuid) from public, anon;
grant execute on function public.report_revenue_by_day(date, date, uuid) to authenticated;
revoke execute on function public.report_staff_performance(date, date, uuid) from public, anon;
grant execute on function public.report_staff_performance(date, date, uuid) to authenticated;
revoke execute on function public.report_top_services(date, date, integer, uuid) from public, anon;
grant execute on function public.report_top_services(date, date, integer, uuid) to authenticated;
revoke execute on function public.report_payment_methods(date, date, uuid) from public, anon;
grant execute on function public.report_payment_methods(date, date, uuid) to authenticated;
revoke execute on function public.report_cash_movements(date, date, uuid) from public, anon;
grant execute on function public.report_cash_movements(date, date, uuid) to authenticated;
revoke execute on function public.public_available_slots(uuid, date, uuid, uuid) from public;
grant execute on function public.public_available_slots(uuid, date, uuid, uuid) to anon, authenticated;
revoke execute on function public.public_create_booking(jsonb) from public;
grant execute on function public.public_create_booking(jsonb) to anon, authenticated;
revoke execute on function public.public_booking_info() from public;
grant execute on function public.public_booking_info() to anon, authenticated;


-- >>>>>>>>>>>>>>>>>>>> 016_housekeeping.sql <<<<<<<<<<<<<<<<<<<<

-- =====================================================================
--  016_housekeeping.sql — Limpieza periódica para contener el tamaño de la BD
--
--  Solo borra datos que ya no aportan valor:
--    · audit_log con más de 400 días (13 meses: permite comparar contra el año anterior)
--    · encuestas NO respondidas con más de 90 días (el enlace vence a los 30)
--  Nunca toca ventas, citas, clientes, caja, comisiones ni inventario.
--  Si la extensión pg_cron está activa (Database → Extensions), se programa
--  cada domingo. Si no, el propietario puede ejecutar: select public.purge_old_records();
--  Re-ejecutable.
-- =====================================================================

create or replace function public.purge_old_records_job()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_audit   integer := 0;
  v_surveys integer := 0;
begin
  if to_regclass('public.audit_log') is not null then
    delete from public.audit_log where occurred_at < now() - interval '400 days';
    get diagnostics v_audit = row_count;
  end if;
  if to_regclass('public.visit_surveys') is not null then
    delete from public.visit_surveys where answered_at is null and created_at < now() - interval '90 days';
    get diagnostics v_surveys = row_count;
  end if;
  return jsonb_build_object('audit_log', v_audit, 'visit_surveys', v_surveys);
end;
$$;

-- Versión para la app: solo el propietario
create or replace function public.purge_old_records()
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_role('owner') then
    raise exception 'Solo el propietario puede ejecutar la limpieza' using errcode = '42501';
  end if;
  return public.purge_old_records_job();
end;
$$;

revoke execute on function public.purge_old_records_job() from public, anon, authenticated;
revoke execute on function public.purge_old_records() from public, anon;
grant execute on function public.purge_old_records() to authenticated;

-- Programación semanal (domingo 03:30 hora de Lima = 08:30 UTC), solo si pg_cron existe
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('salon-housekeeping', '30 8 * * 0', 'select public.purge_old_records_job();');
    exception when others then
      raise notice 'No se pudo programar la limpieza automática: %', sqlerrm;
    end;
  end if;
end;
$$;
