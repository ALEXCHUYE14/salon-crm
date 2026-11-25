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
